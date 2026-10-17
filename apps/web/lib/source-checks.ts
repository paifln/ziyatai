import { db, transaction } from "./db";
import { env } from "./env";
import { enqueue } from "./queue";
import { trustedScan } from "./scan-policy";
import { AppError } from "../../../packages/domain/errors";

async function source(owner: string, plan: string) {
  const result = await db().query(
    "SELECT u.id,u.scan_status,u.status FROM plans p JOIN uploads u ON u.id=p.file_id WHERE p.id=$1 AND p.owner_id=$2 AND p.deleted_at IS NULL AND u.owner_id=$2 AND u.deleted_at IS NULL",
    [plan, owner],
  );
  if (!result.rowCount) throw new AppError("NOT_FOUND", 404);
  return result.rows[0];
}
export async function sourceStatus(owner: string, plan: string) {
  const file = await source(owner, plan);
  const jobs = await db().query(
    "SELECT id,status,error_code,cancel_requested FROM jobs WHERE owner_id=$1 AND kind='scan' AND payload->>'uploadId'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
    [owner, file.id],
  );
  const last = jobs.rows[0];
  const invalid =
    last?.status === "failed" &&
    ["FILE_INVALID", "FILE_UNSAFE", "FILE_SIZE", "FILE_TYPE"].includes(
      last.error_code,
    );
  return {
    available:
      file.status === "complete" && trustedScan(file.scan_status, env()),
    canCheck:
      !invalid &&
      file.status === "complete" &&
      file.scan_status === "unscanned-development" &&
      env().SCAN_REQUIRED === "true",
    job: jobs.rows[0] ?? null,
  };
}
export async function startSourceCheck(
  owner: string,
  plan: string,
  key: string,
) {
  const initial = await source(owner, plan);
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `source-check:${owner}`,
    ]);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [initial.id]);
    const old = await c.query(
      "SELECT id,kind,resource_id FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
      [owner, `scan:${key}`],
    );
    if (old.rowCount) {
      if (old.rows[0].kind !== "scan" || old.rows[0].resource_id !== plan)
        throw new AppError("CONFLICT", 409);
      return { jobId: old.rows[0].id };
    }
    const current = await c.query(
      "SELECT scan_status,status FROM uploads WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
      [initial.id, owner],
    );
    if (!current.rowCount) throw new AppError("NOT_FOUND", 404);
    const file = current.rows[0];
    if (file.status === "complete" && trustedScan(file.scan_status, env()))
      return { jobId: null };
    if (env().SCAN_REQUIRED !== "true")
      throw new AppError("SCAN_UNAVAILABLE", 503);
    if (
      file.status !== "complete" ||
      file.scan_status !== "unscanned-development"
    )
      throw new AppError("FILE_UNSAFE", 422);
    const active = await c.query(
      "SELECT id,kind FROM jobs WHERE owner_id=$1 AND kind IN ('scan','import') AND payload->>'uploadId'=$2 AND status IN ('queued','running') ORDER BY created_at LIMIT 1",
      [owner, initial.id],
    );
    if (active.rowCount) {
      if (active.rows[0].kind !== "scan") throw new AppError("CONFLICT", 409);
      return { jobId: active.rows[0].id };
    }
    const count = await c.query(
      "SELECT count(*)::int AS count FROM jobs WHERE owner_id=$1 AND kind='scan' AND created_at>now()-interval '1 hour'",
      [owner],
    );
    if (count.rows[0].count >= 5) throw new AppError("LIMIT", 429);
    return {
      jobId: await enqueue(
        c,
        owner,
        "scan",
        plan,
        { uploadId: initial.id },
        `scan:${key}`,
      ),
    };
  });
}
