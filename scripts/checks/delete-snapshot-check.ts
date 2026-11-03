import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, transaction } from "../../apps/web/lib/db";
import { env } from "../../apps/web/lib/env";
import { finalizeDeletedObjects } from "../../apps/worker/delete-resources";
import { syntheticDemo } from "../../packages/domain/demo";
import { assertUploadStorageQuota } from "../../apps/web/lib/storage-quota";

if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(env().DATABASE_URL).hostname,
  )
)
  throw new Error("Deletion snapshot check is restricted to a local database");
const rollback = new Error("Rollback synthetic deletion fixtures");
try {
  await assert.rejects(
    transaction(async (client) => {
      const owner = randomUUID();
      await client.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic deletion QA\',$2,true)',
        [owner, `${owner}@example.test`],
      );
      const sample = syntheticDemo("ru");
      async function material(deleted: boolean) {
        const upload = randomUUID(),
          plan = randomUUID(),
          generation = randomUUID(),
          version = randomUUID(),
          exported = randomUUID();
        const sourceKey = `${owner}/uploads/${upload}.docx`,
          exportKey = `${owner}/exports/${exported}.docx`;
        await client.query(
          "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status,deleted_at) VALUES($1,$2,$3,'fixture.docx','application/octet-stream',1,'fixture','clean',CASE WHEN $4 THEN now() END)",
          [upload, owner, sourceKey, deleted],
        );
        await client.query(
          "INSERT INTO plans(id,owner_id,file_id,title,deleted_at) VALUES($1,$2,$3,'Synthetic deletion',CASE WHEN $4 THEN now() END)",
          [plan, owner, upload, deleted],
        );
        await client.query(
          "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale,deleted_at) VALUES($1,$2,$3,$4,$5,'Synthetic deletion','ru',CASE WHEN $6 THEN now() END)",
          [generation, owner, plan, sample.row.id, sample.snapshot, deleted],
        );
        await client.query(
          "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,1,$3,'{}','synthetic','qa')",
          [version, generation, sample.document],
        );
        await client.query(
          "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,status,object_key,deleted_at) VALUES($1,$2,$3,$4,'docx','student','{}','succeeded',$5,CASE WHEN $6 THEN now() END)",
          [exported, owner, generation, version, exportKey, deleted],
        );
        return { upload, plan, generation, exported, sourceKey, exportKey };
      }
      const first = await material(true);
      const capturedKeys = [first.sourceKey, first.exportKey];
      // Represents a deletion committed while the worker was awaiting S3.
      const late = await material(true);
      await finalizeDeletedObjects(client, owner, capturedKeys);
      for (const [table, id] of [
        ["uploads", late.upload],
        ["plans", late.plan],
        ["generations", late.generation],
        ["exports", late.exported],
      ])
        assert.equal(
          (await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id]))
            .rowCount,
          1,
        );
      assert.equal(
        (
          await client.query("SELECT object_key FROM exports WHERE id=$1", [
            late.exported,
          ])
        ).rows[0].object_key,
        late.exportKey,
      );
      assert.equal(
        (
          await client.query("SELECT 1 FROM uploads WHERE id=$1", [
            first.upload,
          ])
        ).rowCount,
        0,
      );
      await finalizeDeletedObjects(client, owner, [
        late.sourceKey,
        late.exportKey,
      ]);
      assert.equal(
        (await client.query("SELECT 1 FROM uploads WHERE owner_id=$1", [owner]))
          .rowCount,
        0,
      );

      const accountFirst = await material(true);
      const delayedWrite = await material(false);
      await client.query("SAVEPOINT account_probe");
      await assert.rejects(
        finalizeDeletedObjects(
          client,
          owner,
          [accountFirst.sourceKey, accountFirst.exportKey],
          true,
        ),
        { code: "INTERNAL", status: 503 },
      );
      await client.query("ROLLBACK TO SAVEPOINT account_probe");
      assert.equal(
        (
          await client.query("SELECT object_key FROM uploads WHERE id=$1", [
            delayedWrite.upload,
          ])
        ).rows[0].object_key,
        delayedWrite.sourceKey,
      );
      await finalizeDeletedObjects(
        client,
        owner,
        [
          accountFirst.sourceKey,
          accountFirst.exportKey,
          delayedWrite.sourceKey,
          delayedWrite.exportKey,
        ],
        true,
      );
      assert.equal(
        (
          await client.query(
            "SELECT 1 FROM uploads WHERE owner_id=$1 UNION ALL SELECT 1 FROM exports WHERE owner_id=$1",
            [owner],
          )
        ).rowCount,
        0,
      );
      await client.query(
        "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status,deleted_at) SELECT gen_random_uuid(),$1,$1||'/synthetic-quota/'||n,'fixture.docx','application/octet-stream',1,'fixture','clean',now() FROM generate_series(1,100) n",
        [owner],
      );
      await assert.rejects(assertUploadStorageQuota(client, owner, 1), {
        code: "LIMIT",
        status: 429,
      });
      await client.query(
        "DELETE FROM uploads WHERE id=(SELECT id FROM uploads WHERE owner_id=$1 LIMIT 1)",
        [owner],
      );
      await assertUploadStorageQuota(client, owner, 1);
      throw rollback;
    }),
    (error) => error === rollback,
  );
  console.log(
    JSON.stringify({
      scope:
        "Real local PostgreSQL; synthetic metadata only; no storage objects touched; all fixtures rolled back",
      lateTombstonePointersPreserved: true,
      processedObjectsFinalized: true,
      laterBatchCompletes: true,
      lateAccountWriteForcesRetryWithoutLosingPointer: true,
      tombstonesHoldStorageQuotaUntilPhysicalCleanup: true,
    }),
  );
} finally {
  await db().end();
}
