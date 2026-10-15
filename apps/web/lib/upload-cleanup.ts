import { transaction, db } from "./db";
import { deleteObject } from "./storage";

/** Failed storage deletes remain tombstoned and are retried next sweep. */
export async function cleanupAbandonedUploads(remove = deleteObject) {
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
    try {
      await remove(upload.object_key);
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
