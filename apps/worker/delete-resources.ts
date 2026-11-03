import type { PoolClient } from "pg";
import { AppError } from "../../packages/domain/errors";

/** Caller owns the transaction and has deleted exactly these object keys in S3.
 * Later tombstones must retain their pointers for the next deletion job/sweep.
 */
export async function finalizeDeletedObjects(
  connection: PoolClient,
  owner: string,
  keys: string[],
  account = false,
) {
  await connection.query(
    "UPDATE exports SET object_key=NULL WHERE owner_id=$1 AND ($3::boolean OR deleted_at IS NOT NULL) AND object_key=ANY($2::text[])",
    [owner, keys, account],
  );
  await connection.query(
    "DELETE FROM exports WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) AND object_key IS NULL",
    [owner, account],
  );
  await connection.query(
    "DELETE FROM generations g WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM exports e WHERE e.generation_id=g.id)",
    [owner, account],
  );
  await connection.query(
    "DELETE FROM plans p WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM generations g WHERE g.plan_id=p.id)",
    [owner, account],
  );
  await connection.query(
    "DELETE FROM uploads u WHERE owner_id=$1 AND ($3::boolean OR deleted_at IS NOT NULL) AND object_key=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM plans p WHERE p.file_id=u.id)",
    [owner, keys, account],
  );
  if (account) {
    const remaining = await connection.query(
      "SELECT 1 FROM uploads WHERE owner_id=$1 UNION ALL SELECT 1 FROM exports WHERE owner_id=$1 UNION ALL SELECT 1 FROM generations WHERE owner_id=$1 UNION ALL SELECT 1 FROM plans WHERE owner_id=$1 LIMIT 1",
      [owner],
    );
    // A write admitted before account deletion may have committed after the
    // snapshot. Retry with its key; never discard the only remaining pointer.
    if (remaining.rowCount) throw new AppError("INTERNAL", 503);
  }
}
