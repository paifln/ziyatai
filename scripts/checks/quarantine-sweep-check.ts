import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cleanupQuarantinePage } from "../../server/infrastructure/storage/upload-cleanup";
import {
  putObject,
  getObject,
  deleteObject,
  listQuarantinePage,
} from "../../server/infrastructure/storage/storage";

// Exercise real S3 listing/deletion without aging or touching existing objects.
const key = `quarantine/synthetic-sweep-check/${randomUUID()}.txt`;
try {
  await putObject(key, Buffer.from("Synthetic orphan fixture"), "text/plain");
  let cursor: string | undefined;
  let fixture:
    | Awaited<ReturnType<typeof listQuarantinePage>>["objects"][number]
    | undefined;
  do {
    const page = await listQuarantinePage(cursor);
    fixture = page.objects.find((object) => object.Key === key);
    cursor = page.nextCursor;
  } while (!fixture && cursor);
  assert.ok(fixture?.LastModified, "Real S3 listing must return LastModified");
  const listOwnFixture = async () => ({
    objects: [fixture!],
    nextCursor: undefined,
  });
  const removeOwnFixture = async (candidate: string) => {
    assert.equal(candidate, key, "Never delete outside this synthetic fixture");
    await deleteObject(candidate);
  };
  const timestamp = fixture.LastModified.getTime();
  const fresh = await cleanupQuarantinePage(
    undefined,
    listOwnFixture,
    removeOwnFixture,
    timestamp + 1000,
  );
  assert.equal(fresh.removed, 0);
  assert.ok((await getObject(key)).length);
  const expired = await cleanupQuarantinePage(
    undefined,
    listOwnFixture,
    removeOwnFixture,
    timestamp + 86400001,
  );
  assert.equal(expired.removed, 1);
  assert.equal(expired.failed, 0);
  await assert.rejects(getObject(key));
  const report = {
    environment: "local private S3, no cloud changes",
    realListObjectsV2: true,
    recentObjectPreserved: true,
    expiredOrphanDeleted: true,
    clock: "injected for one synthetic object only",
    existingObjectsModified: false,
  };
  await mkdir(".local/qa", { recursive: true });
  await writeFile(
    ".local/qa/quarantine-sweep.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await deleteObject(key);
}
