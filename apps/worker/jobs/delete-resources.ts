import { db, transaction } from "../../../server/infrastructure/database/db";
import { deleteSupabaseIdentity } from "../../../server/auth/admin";
import { deleteObject } from "../../../server/infrastructure/storage/storage";
import { finalizeDeletedObjects } from "../delete-resources";
import { type Job, check, stage, done } from "./context";
export async function deleteResources(job: Job) {
  await stage(job, "deleting");
  const keys = await db().query(
    "SELECT object_key FROM uploads WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) UNION SELECT object_key FROM exports WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) AND object_key IS NOT NULL",
    [job.owner_id, job.payload.scope === "account"],
  );
  for (const { object_key } of keys.rows) await deleteObject(object_key);
  if (job.payload.scope === "account")
    await deleteSupabaseIdentity(job.owner_id);
  await transaction(async (c) => {
    await check(c, job);
    await finalizeDeletedObjects(
      c,
      job.owner_id,
      keys.rows.map((row) => row.object_key),
      job.payload.scope === "account",
    );
    await done(c, job, { deletedObjects: keys.rowCount });
    if (job.payload.scope === "account") {
      await c.query("DELETE FROM usage_ledger WHERE owner_id=$1", [
        job.owner_id,
      ]);
      await c.query("DELETE FROM jobs WHERE owner_id=$1", [job.owner_id]);
      await c.query("DELETE FROM audit WHERE owner_id=$1", [job.owner_id]);
      await c.query('DELETE FROM "user" WHERE id=$1', [job.owner_id]);
    }
  });
}
