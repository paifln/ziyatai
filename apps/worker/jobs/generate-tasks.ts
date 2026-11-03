import { randomUUID } from "node:crypto";
import { db, transaction } from "../../../server/infrastructure/database/db";
import { validateDocument } from "../../../packages/domain/validation";
import { AppError } from "../../../packages/domain/errors";
import { generate } from "../ai";
import { type Job, check, stage, active, done } from "./context";
export async function generateTasks(job: Job) {
  await stage(job, "generating");
  const g = await active("generations", job);
  let old: any;
  let task: any;
  if (job.kind === "regenerate") {
    if (g.revision !== job.payload.revision)
      throw new AppError("CONFLICT", 409);
    old = (
      await db().query(
        "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
        [g.id, g.revision],
      )
    ).rows[0];
    task = old.document.tasks.find((t: any) => t.id === job.payload.taskId);
    if (!task) throw new AppError("NOT_FOUND", 404);
  }
  const result = await generate(
    g.source_snapshot,
    task ? { task } : undefined,
    async () => {
      const budget = await db().query(
        "UPDATE jobs SET provider_calls=provider_calls+1 WHERE id=$1 AND lease_token=$2 AND provider_calls<3 AND cancel_requested=false RETURNING id",
        [job.id, job.lease_token],
      );
      if (!budget.rowCount) throw new AppError("AI_INVALID", 422);
    },
  );
  await stage(job, "validating");
  const document = result.doc ?? {
    ...old.document,
    tasks: old.document.tasks.map((t: any) =>
      t.id === task.id ? result.task : t,
    ),
  };
  const report = validateDocument(document, g.source_snapshot);
  if (report.issues.length) throw new AppError("AI_INVALID", 422);
  await transaction(async (c) => {
    await check(c, job);
    const current = await active("generations", job, c);
    if (job.kind === "regenerate" && current.revision !== job.payload.revision)
      throw new AppError("CONFLICT", 409);
    const revision = job.kind === "regenerate" ? g.revision + 1 : 1;
    await c.query(
      "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version,usage,provider_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(generation_id,revision) DO NOTHING",
      [
        randomUUID(),
        g.id,
        revision,
        document,
        { ...report, doc: undefined },
        result.model,
        result.promptVersion,
        result.usage,
        result.requestId,
      ],
    );
    await c.query(
      "UPDATE generations SET status='needs_review',revision=$2 WHERE id=$1",
      [g.id, revision],
    );
    await c.query(
      "UPDATE usage_ledger SET state='charged',tokens=tokens+$2 WHERE job_id=$1",
      [
        job.id,
        (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
      ],
    );
    await done(c, job, { generationId: g.id, revision });
  });
}
