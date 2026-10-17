import type { PoolClient } from "pg";

/** Caller owns the transaction. Lock jobs before changing resources or quotas. */
export async function recoverExpiredJobs(c: PoolClient) {
  const expired = await c.query<{
    id: string;
    owner_id: string;
    resource_id: string;
    kind: string;
    cancel_requested: boolean;
    attempt: number;
    max_attempts: number;
    provider_calls: number;
  }>(
    "SELECT id,owner_id,resource_id,kind,cancel_requested,attempt,max_attempts,provider_calls FROM jobs WHERE status='running' AND lease_until<now() ORDER BY lease_until,id LIMIT 100 FOR UPDATE SKIP LOCKED",
  );
  const counts = { queued: 0, failed: 0, cancelled: 0 };
  for (const job of expired.rows) {
    const uncertainAI =
      ["generate", "regenerate"].includes(job.kind) && job.provider_calls > 0;
    const status = job.cancel_requested
      ? "cancelled"
      : uncertainAI || job.attempt >= job.max_attempts
        ? "failed"
        : "queued";
    const code = job.cancel_requested
      ? "CANCELLED"
      : uncertainAI
        ? "AI_UNCERTAIN"
        : status === "failed"
          ? "ATTEMPTS_EXHAUSTED"
          : "WORKER_RESTART";
    await c.query(
      "UPDATE jobs SET status=$2,stage=$2,error_code=$3,lease_until=NULL,lease_token=NULL,available_at=now(),updated_at=now() WHERE id=$1",
      [job.id, status, code],
    );
    counts[status]++;
    if (status === "queued") continue;
    // A request may have been billed before its worker disappeared. Retain its
    // conservative token reservation without blocking a concurrent-job slot.
    await c.query(
      "UPDATE usage_ledger SET state=CASE WHEN $2::boolean OR tokens>0 THEN 'uncertain' ELSE 'released' END WHERE job_id=$1 AND state='reserved'",
      [job.id, job.provider_calls > 0],
    );
    const resource =
      job.kind === "import"
        ? { table: "plans", pending: "extracting" }
        : job.kind === "generate"
          ? { table: "generations", pending: "queued" }
          : job.kind === "export"
            ? { table: "exports", pending: "queued" }
            : null;
    // Regeneration failures must preserve the existing material and approval.
    if (resource)
      await c.query(
        `UPDATE ${resource.table} SET status=$3 WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND status=$4`,
        [job.resource_id, job.owner_id, status, resource.pending],
      );
  }
  return counts;
}
