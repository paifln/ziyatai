import { transaction, db } from "./db";
import { deleteObject, listQuarantinePage } from "./storage";

/** Also removes old signed-URL replays that no longer have a database row. */
export async function cleanupQuarantinePage(
  cursor?: string,
  list = listQuarantinePage,
  remove = deleteObject,
  now = Date.now(),
  signal = AbortSignal.timeout(10000),
) {
  const page = await list(cursor, signal);
  let removed = 0,
    failed = 0;
  for (const object of page.objects) {
    if (signal.aborted) break;
    const age = object.LastModified?.getTime();
    if (
      !object.Key?.startsWith("quarantine/") ||
      age === undefined ||
      !Number.isFinite(age) ||
      now - age <= 86400000
    )
      continue;
    try {
      await remove(object.Key, signal);
      removed++;
    } catch {
      failed++;
    }
  }
  // Retry this page after a deadline; advancing would skip unvisited objects.
  return {
    removed,
    failed,
    nextCursor: signal.aborted ? cursor : page.nextCursor,
  };
}

/** Failed storage deletes remain tombstoned and are retried next sweep. */
export async function cleanupAbandonedUploads(
  remove = deleteObject,
  signal = AbortSignal.timeout(10000),
) {
  const abandoned = await transaction(async (c) => {
    const candidates = await c.query(
      "SELECT id FROM uploads WHERE (deleted_at IS NOT NULL OR (status='pending' AND created_at<now()-interval '15 minutes') OR created_at<now()-interval '24 hours') AND NOT EXISTS(SELECT 1 FROM plans WHERE file_id=uploads.id) ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    if (!candidates.rowCount) return [];
    // Fresh snapshot after locking: preserve an import committed just before
    // the lock was acquired. Imports lock this same upload before creating a plan.
    return (
      await c.query(
        "UPDATE uploads SET deleted_at=coalesce(deleted_at,now()) WHERE id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM plans WHERE file_id=uploads.id) RETURNING id,object_key",
        [candidates.rows.map((row) => row.id)],
      )
    ).rows;
  });
  let removed = 0,
    failed = 0;
  for (const upload of abandoned) {
    if (signal.aborted) break;
    try {
      await remove(upload.object_key, signal);
      await db().query(
        "DELETE FROM uploads WHERE id=$1 AND deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plans WHERE file_id=uploads.id)",
        [upload.id],
      );
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
