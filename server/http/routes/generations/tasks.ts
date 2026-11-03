import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../../request-body";
import { transaction } from "../../../infrastructure/database/db";
import { enqueue, reserveQuota } from "../../../infrastructure/queue/queue";
import { AppError } from "../../../../packages/domain/errors";
import { Task } from "../../../../packages/contracts";
import { validateDocument } from "../../../../packages/domain/validation";
import { type ApiContext, uid, json, currentGeneration } from "../../context";
export async function handleGenerationsTasks(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, path, resource, id, action, child, method, owner } = context;
  if (
    resource === "generations" &&
    id &&
    action === "tasks" &&
    child &&
    method === "PATCH"
  ) {
    const b = z
      .object({ revision: z.number().int().positive(), task: Task })
      .parse(await body(req));
    if (b.task.id !== child) throw new AppError("FILE_INVALID", 422);
    return json(
      await transaction(async (c) => {
        const g = (
          await c.query(
            "SELECT * FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [id, owner],
          )
        ).rows[0];
        if (!g) throw new AppError("NOT_FOUND", 404);
        if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
        const old = (
          await c.query(
            "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
            [id, b.revision],
          )
        ).rows[0];
        const index = old.document.tasks.findIndex((t: any) => t.id === child);
        if (index < 0) throw new AppError("NOT_FOUND", 404);
        if (b.task.level !== old.document.tasks[index].level)
          throw new AppError("AI_INVALID", 422);
        old.document.tasks[index] = b.task;
        const report = validateDocument(old.document, g.source_snapshot);
        const revision = b.revision + 1;
        await c.query(
          "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            id,
            revision,
            old.document,
            { ...report, doc: undefined, stale: true },
            old.model,
            old.prompt_version,
          ],
        );
        await c.query(
          "UPDATE generations SET revision=$2,status='needs_review' WHERE id=$1",
          [id, revision],
        );
        return { revision };
      }),
    );
  }
  if (
    resource === "generations" &&
    id &&
    action === "tasks" &&
    child &&
    path[4] === "regenerate" &&
    method === "POST"
  ) {
    const g = await currentGeneration(id, owner);
    if (g.demo) throw new AppError("AI_UNAVAILABLE", 503);
    const b = z
      .object({ revision: z.number().int().positive() })
      .parse(await body(req));
    if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
    const regenerationTask = g.document.tasks.find((t: any) => t.id === child);
    if (!regenerationTask) throw new AppError("NOT_FOUND", 404);
    const key = uid.parse(req.headers.get("idempotency-key"));
    const jobId = await transaction(async (c) => {
      const locked = (
        await c.query(
          "SELECT revision FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [id, owner],
        )
      ).rows[0];
      if (!locked) throw new AppError("NOT_FOUND", 404);
      if (locked.revision !== b.revision) throw new AppError("CONFLICT", 409);
      const j = await enqueue(
        c,
        owner,
        "regenerate",
        id,
        { taskId: child, revision: b.revision },
        key,
      );
      const old = await c.query("SELECT 1 FROM usage_ledger WHERE job_id=$1", [
        j,
      ]);
      if (!old.rowCount)
        await reserveQuota(c, owner, j, {
          snapshot: g.source_snapshot,
          replace: regenerationTask,
        });
      return j;
    });
    return json({ jobId }, 202);
  }
}
