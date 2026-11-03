import { transaction } from "../../../server/infrastructure/database/db";
import { AppError } from "../../../packages/domain/errors";
import { type Job } from "./context";
export async function fail(job: Job, error: unknown) {
  const code = error instanceof AppError ? error.code : "INTERNAL";
  const retry =
    [
      "AI_RATE_LIMIT",
      "AI_TEMPORARY",
      "INTERNAL",
      "RENDER_UNAVAILABLE",
    ].includes(code) && job.attempt < job.max_attempts;
  await transaction(async (c) => {
    const own = await c.query(
      "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
      [job.id, job.lease_token],
    );
    if (!own.rowCount) return;
    const cancelled = own.rows[0].cancel_requested || code === "CANCELLED";
    const metering = (error as any)?.providerUsage;
    const billedTokens =
      (metering?.input_tokens ?? 0) + (metering?.output_tokens ?? 0);
    if (billedTokens)
      await c.query(
        "UPDATE usage_ledger SET tokens=tokens+$2 WHERE job_id=$1",
        [job.id, billedTokens],
      );
    const status = cancelled ? "cancelled" : retry ? "queued" : "failed";
    await c.query(
      "UPDATE jobs SET status=$3,stage=$3,error_code=$4,available_at=now()+$5*interval '1 second',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [
        job.id,
        job.lease_token,
        status,
        code,
        Math.min(120, 2 ** job.attempt * 3) + Math.random() * 3,
      ],
    );
    if (!retry || cancelled) {
      await c.query(
        "UPDATE usage_ledger SET state=$2 WHERE job_id=$1 AND state='reserved'",
        [
          job.id,
          billedTokens > 0 ||
          code === "AI_UNCERTAIN" ||
          code === "AI_INVALID" ||
          code === "AI_INCOMPLETE"
            ? "uncertain"
            : "released",
        ],
      );
      if (job.kind === "import")
        await c.query(
          "UPDATE plans SET status=$2 WHERE id=$1 AND deleted_at IS NULL",
          [job.resource_id, cancelled ? "cancelled" : "failed"],
        );
      if (job.kind === "generate")
        await c.query(
          "UPDATE generations SET status=$2 WHERE id=$1 AND deleted_at IS NULL",
          [job.resource_id, cancelled ? "cancelled" : "failed"],
        );
      if (job.kind === "export")
        await c.query(
          "UPDATE exports SET status=$2 WHERE id=$1 AND deleted_at IS NULL",
          [job.resource_id, cancelled ? "cancelled" : "failed"],
        );
    }
  });
  console.log(
    JSON.stringify({
      jobId: job.id,
      outcome: retry ? "retry" : "failed",
      code,
    }),
  );
}
