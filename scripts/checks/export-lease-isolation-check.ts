import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { exportObjectKey } from "../../apps/worker/object-keys";
import { putObject, getObject, deleteObject } from "../../apps/web/lib/storage";
import { env } from "../../apps/web/lib/env";

if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(env().STORAGE_ENDPOINT).hostname,
  )
)
  throw new Error(
    "Export lease isolation check is restricted to local storage",
  );
const owner = `synthetic-lease-${randomUUID()}`,
  exported = randomUUID();
const oldKey = exportObjectKey(owner, exported, randomUUID(), "docx");
const newKey = exportObjectKey(owner, exported, randomUUID(), "docx");
assert.notEqual(oldKey, newKey);
const newer = Buffer.from("Synthetic new lease publication");
try {
  await putObject(
    oldKey,
    Buffer.from("Synthetic expired lease publication"),
    "text/plain",
  );
  await putObject(newKey, newer, "text/plain");
  // The stale attempt loses its database fence and runs its finally cleanup.
  await deleteObject(oldKey);
  assert.deepEqual(await getObject(newKey), newer);
  await assert.rejects(getObject(oldKey));
  console.log(
    JSON.stringify({
      scope:
        "Own synthetic objects in local private S3; no application rows or existing objects touched",
      attemptsUseDifferentKeys: true,
      staleCleanupCannotRemoveNewPublication: true,
    }),
  );
} finally {
  const cleanup = await Promise.allSettled([
    deleteObject(oldKey),
    deleteObject(newKey),
  ]);
  if (cleanup.some((result) => result.status === "rejected"))
    throw new Error("Synthetic lease fixture cleanup failed");
}
