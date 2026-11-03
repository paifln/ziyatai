import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../request-body";
import { transaction } from "../../infrastructure/database/db";
import { enqueue } from "../../infrastructure/queue/queue";
import { AppError } from "../../../packages/domain/errors";
import { Styles } from "../../../packages/contracts";
import { validateDocument } from "../../../packages/domain/validation";
import { objectDownload } from "../../infrastructure/storage/object-download";
import {
  type ApiContext,
  uid,
  owned,
  json,
  currentGeneration,
} from "../context";
export async function handleExports(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, id, action, method, owner } = context;
  if (resource === "exports" && !id && method === "POST") {
    const b = z
      .object({
        generationId: uid,
        revision: z.number().int().positive(),
        format: z.enum(["docx", "pdf"]),
        audience: z.enum(["full", "student"]),
        styles: Styles,
        teacherReviewed: z.boolean().default(false),
      })
      .parse(await body(req));
    const g = await currentGeneration(b.generationId, owner, b.revision);
    if (!g.document) throw new AppError("NOT_FOUND", 404);
    if (!g.reviewed_at || g.reviewed_by !== owner || !b.teacherReviewed)
      throw new AppError("REVIEW_REQUIRED", 422);
    if (
      b.teacherReviewed &&
      validateDocument(g.document, g.source_snapshot).issues.length
    )
      throw new AppError("REVIEW_REQUIRED", 422);
    const key = uid.parse(req.headers.get("idempotency-key"));
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
          old.rows[0].kind !== "export" ||
          old.rows[0].payload.requestHash !== requestHash
        )
          throw new AppError("CONFLICT", 409);
        return { id: old.rows[0].resource_id, jobId: old.rows[0].id };
      }
      const count = await c.query(
        "SELECT count(*)::int FROM exports WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
        [owner],
      );
      if (count.rows[0].count >= 100) throw new AppError("LIMIT", 429);
      const eid = randomUUID();
      const locked = await c.query(
        "SELECT revision FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [g.id, owner],
      );
      if (!locked.rowCount) throw new AppError("NOT_FOUND", 404);
      if (locked.rows[0].revision !== b.revision)
        throw new AppError("CONFLICT", 409);
      const pending = await c.query(
        "SELECT 1 FROM jobs WHERE resource_id=$1 AND kind IN ('generate','regenerate') AND status IN ('queued','running')",
        [g.id],
      );
      if (pending.rowCount) throw new AppError("CONFLICT", 409);
      await c.query(
        "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,teacher_reviewed) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          eid,
          owner,
          g.id,
          g.versionId,
          b.format,
          b.audience,
          b.styles,
          b.teacherReviewed,
        ],
      );
      return {
        id: eid,
        jobId: await enqueue(c, owner, "export", eid, { requestHash }, key),
      };
    });
    return json(result, 202);
  }
  if (
    resource === "exports" &&
    id &&
    action === "download" &&
    ["GET", "HEAD"].includes(method)
  ) {
    const ex = await owned("exports", id, owner);
    await owned("generations", ex.generation_id, owner);
    if (!ex.teacher_reviewed) throw new AppError("REVIEW_REQUIRED", 422);
    if (ex.status !== "succeeded" || !ex.object_key)
      throw new AppError("CONFLICT", 409);
    return await objectDownload(req, ex.object_key, {
      "Content-Type":
        ex.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="ZiyatAI-${ex.audience}.${ex.format}"`,
    });
  }
}
