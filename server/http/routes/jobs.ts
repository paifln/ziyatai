import { db, transaction } from "../../infrastructure/database/db";
import { AppError, messages } from "../../../packages/domain/errors";
import { type ApiContext, owned, json } from "../context";
export async function handleJobs(
  context: ApiContext,
): Promise<Response | undefined> {
  const { resource, id, action, method, owner, limit, offset } = context;
  if (resource === "jobs" && id) {
    const job = await owned("jobs", id, owner);
    if (method === "POST" && action === "retry") {
      if (
        !["import", "export"].includes(job.kind) ||
        !["failed", "cancelled"].includes(job.status)
      )
        throw new AppError("CONFLICT", 409);
      const table = job.kind === "import" ? "plans" : "exports";
      await owned(table, job.resource_id, owner);
      await transaction(async (c) => {
        const updated = await c.query(
          "UPDATE jobs SET status='queued',stage='queued',attempt=0,cancel_requested=false,error_code=NULL,available_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND owner_id=$2 AND status IN('failed','cancelled') RETURNING id",
          [id, owner],
        );
        if (!updated.rowCount) throw new AppError("CONFLICT", 409);
        await c.query(`UPDATE ${table} SET status=$2 WHERE id=$1`, [
          job.resource_id,
          job.kind === "import" ? "extracting" : "queued",
        ]);
      });
      return json({ jobId: id }, 202);
    }
    if (method === "GET")
      return json({
        id: job.id,
        kind: job.kind,
        status: job.status,
        stage: job.stage,
        attempt: job.attempt,
        cancelRequested: job.cancel_requested,
        error: job.error_code
          ? {
              code: job.error_code,
              message: messages[job.error_code] ?? messages.INTERNAL,
            }
          : null,
        result: job.result,
        resourceId: job.resource_id,
      });
    if (method === "POST" && action === "cancel") {
      await transaction(async (c) => {
        const cancelled = await c.query(
          "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,stage=CASE WHEN status='queued' THEN 'cancelled' ELSE stage END WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running') RETURNING kind,resource_id,status",
          [id, owner],
        );
        const row = cancelled.rows[0];
        if (row?.status === "cancelled") {
          await c.query(
            "UPDATE usage_ledger SET state='released' WHERE job_id=$1 AND state='reserved'",
            [id],
          );
          const table =
            row.kind === "import"
              ? "plans"
              : row.kind === "generate"
                ? "generations"
                : row.kind === "export"
                  ? "exports"
                  : null;
          if (table)
            await c.query(
              `UPDATE ${table} SET status='cancelled' WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
              [row.resource_id, owner],
            );
        }
      });
      return json({ cancelRequested: true });
    }
  }
  if (resource === "jobs" && !id && method === "GET")
    return json(
      (
        await db().query(
          "SELECT id,kind,status,stage,error_code,cancel_requested,resource_id,created_at FROM jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
          [owner, limit, offset],
        )
      ).rows,
    );
}
