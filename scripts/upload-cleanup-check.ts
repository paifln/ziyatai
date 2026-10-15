import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db } from "../apps/web/lib/db";
import { cleanupAbandonedUploads } from "../apps/web/lib/upload-cleanup";
import { putObject, deleteObject, getObject } from "../apps/web/lib/storage";

const owner = randomUUID(),
  plan = randomUUID();
const ids = Array.from({ length: 4 }, () => randomUUID());
const keys = ids.map((id) => `quarantine/${owner}/${id}.docx`);
try {
  await db().query(
    'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
    [owner, "Synthetic cleanup test", `${owner}@example.test`],
  );
  for (let i = 0; i < 4; i++) {
    await putObject(
      keys[i],
      Buffer.from("Synthetic cleanup fixture"),
      "application/octet-stream",
    );
    await db().query(
      "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status,status,created_at) VALUES($1,$2,$3,'fixture.docx','application/octet-stream',25,'','pending',$4,now()-interval '16 minutes')",
      [ids[i], owner, keys[i], i === 2 ? "complete" : "pending"],
    );
  }
  await db().query(
    "INSERT INTO plans(id,owner_id,file_id,title) VALUES($1,$2,$3,'Synthetic referenced source')",
    [plan, owner, ids[3]],
  );
  const first = await cleanupAbandonedUploads(async (key) => {
    if (key === keys[1]) throw new Error("Simulated temporary storage outage");
    await deleteObject(key);
  });
  assert.ok(first.failed >= 1);
  assert.equal(
    (await db().query("SELECT 1 FROM uploads WHERE id=$1", [ids[0]])).rowCount,
    0,
  );
  assert.ok(
    (await db().query("SELECT deleted_at FROM uploads WHERE id=$1", [ids[1]]))
      .rows[0].deleted_at,
  );
  assert.equal(
    (
      await db().query(
        "SELECT count(*)::int AS n FROM uploads WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL",
        [ids.slice(2)],
      )
    ).rows[0].n,
    2,
  );
  await cleanupAbandonedUploads();
  assert.equal(
    (await db().query("SELECT 1 FROM uploads WHERE id=$1", [ids[1]])).rowCount,
    0,
  );
  for (const key of keys.slice(2)) assert.ok((await getObject(key)).length > 0);
  const report = {
    date: new Date().toISOString().slice(0, 10),
    environment: "Local PostgreSQL and private S3",
    expiredPendingReleased: true,
    failedStorageDeletionRetried: true,
    recentCompletePreserved: true,
    referencedSourcePreserved: true,
  };
  await writeFile(
    "docs/reports/upload-cleanup.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  for (const key of keys) await deleteObject(key).catch(() => {});
  await db().query("DELETE FROM plans WHERE id=$1", [plan]);
  await db().query("DELETE FROM uploads WHERE owner_id=$1", [owner]);
  await db().query('DELETE FROM "user" WHERE id=$1', [owner]);
  await db().end();
}
