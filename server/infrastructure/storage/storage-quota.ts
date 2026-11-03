import type { PoolClient } from "pg";
import { AppError } from "../../../packages/domain/errors";

/** Tombstones still occupy storage until a worker actually removes their row. */
export async function assertUploadStorageQuota(
  connection: Pick<PoolClient, "query">,
  owner: string,
  incomingBytes: number,
) {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes <= 0)
    throw new AppError("FILE_SIZE", 413);
  const usage = (
    await connection.query(
      "SELECT COALESCE(sum(bytes),0)::bigint AS bytes,count(*)::int AS count FROM uploads WHERE owner_id=$1",
      [owner],
    )
  ).rows[0];
  if (
    BigInt(usage.bytes) + BigInt(incomingBytes) > 500n * 1024n * 1024n ||
    usage.count >= 100
  )
    throw new AppError("LIMIT", 429);
}
