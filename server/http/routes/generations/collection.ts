import { rowGrade } from "../../../../packages/domain/grades";
import {
  hasRequiredGoals,
  maySkipGoals,
} from "../../../../packages/domain/goals";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../../request-body";
import { db, transaction } from "../../../infrastructure/database/db";
import { env } from "../../../config/env";
import { enqueue, reserveQuota } from "../../../infrastructure/queue/queue";
import { AppError } from "../../../../packages/domain/errors";
import { GenerateInput, type KtpRow } from "../../../../packages/contracts";
import {
  type ApiContext,
  uid,
  owned,
  json,
  currentPlan,
  currentGeneration,
} from "../../context";
export async function handleGenerationsCollection(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, id, action, method, url, owner } = context;
  if (resource === "generations" && !id && method === "POST") {
    if (!env().OPENAI_API_KEY || !env().OPENAI_MODEL)
      throw new AppError("AI_UNAVAILABLE", 503);
    const b = GenerateInput.parse(await body(req));
    const plan = await currentPlan(b.planId, owner);
    if (plan.revision !== b.revision) throw new AppError("CONFLICT", 409);
    if (plan.status !== "confirmed") throw new AppError("UNCONFIRMED", 422);
    const row = (plan.rows as KtpRow[]).find((r) => r.id === b.rowId);
    if (!row || !hasRequiredGoals(row) || !rowGrade(row, plan.grade))
      throw new AppError("UNCONFIRMED", 422);
    const key = req.headers.get("idempotency-key");
    uid.parse(key);
    const result = await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        owner + key,
      ]);
      const requestHash = createHash("sha256")
        .update(JSON.stringify(b))
        .digest("hex");
      const old = await c.query(
        "SELECT id,resource_id,kind,payload FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
        [owner, key],
      );
      if (old.rowCount) {
        if (
          old.rows[0].kind !== "generate" ||
          old.rows[0].payload.requestHash !== requestHash
        )
          throw new AppError("CONFLICT", 409);
        return { id: old.rows[0].resource_id, jobId: old.rows[0].id };
      }
      const gid = randomUUID();
      const locked = await c.query(
        "SELECT 1 FROM plans WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND revision=$3 AND status=$4 FOR UPDATE",
        [plan.id, owner, plan.revision, "confirmed"],
      );
      if (!locked.rowCount) throw new AppError("CONFLICT", 409);
      const snapshot = {
        id: randomUUID(),
        topic: row.topic,
        goals: maySkipGoals(row) ? "" : row.goals,
        goalsSkipped: maySkipGoals(row),
        objectiveCodes: maySkipGoals(row)
          ? ["assessment"]
          : row.objectiveCodes.length
            ? row.objectiveCodes
            : ["manual"],
        grade: rowGrade(row, plan.grade),
        subject:
          (
            await c.query('SELECT "teachingSubject" FROM "user" WHERE id=$1', [
              owner,
            ])
          ).rows[0]?.teachingSubject || "general",
        locale: b.locale,
        count: b.count,
        minutes: b.minutes,
        constraints: b.constraints,
        format: b.format,
        planRevision: plan.revision,
      };
      await c.query(
        "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [gid, owner, plan.id, row.id, snapshot, row.topic, b.locale],
      );
      const jobId = await enqueue(
        c,
        owner,
        "generate",
        gid,
        { requestHash },
        key!,
      );
      await reserveQuota(c, owner, jobId, { snapshot, replace: null });
      return { id: gid, jobId };
    });
    return json(result, 202);
  }
  if (resource === "generations" && id && !action && method === "GET") {
    const value = url.searchParams.get("revision");
    const revision =
      value === null
        ? undefined
        : z.coerce.number().int().positive().max(2147483647).parse(value);
    const result = await currentGeneration(id, owner, revision);
    if (revision !== undefined && !result.versionId)
      throw new AppError("NOT_FOUND", 404);
    return json(result);
  }
  if (
    resource === "generations" &&
    id &&
    action === "versions" &&
    method === "GET"
  ) {
    await owned("generations", id, owner);
    return json(
      (
        await db().query(
          "SELECT revision,created_at FROM generation_versions WHERE generation_id=$1 ORDER BY revision DESC",
          [id],
        )
      ).rows,
    );
  }
}
