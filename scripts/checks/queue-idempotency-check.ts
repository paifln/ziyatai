import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, transaction } from "../../server/infrastructure/database/db";
import { env } from "../../server/config/env";
import { enqueue } from "../../server/infrastructure/queue/queue";

if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(env().DATABASE_URL).hostname,
  )
)
  throw new Error("Queue idempotency check is restricted to a local database");

const rollback = new Error("Rollback synthetic idempotency fixtures");
try {
  await assert.rejects(
    transaction(async (client) => {
      const owner = randomUUID(),
        other = randomUUID(),
        resource = randomUUID(),
        key = randomUUID();
      for (const id of [owner, other])
        await client.query(
          'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic idempotency QA\',$2,true)',
          [id, `${id}@example.test`],
        );
      const payload = { taskId: "task-1", revision: 1 };
      const first = await enqueue(
        client,
        owner,
        "regenerate",
        resource,
        payload,
        key,
      );
      assert.equal(
        await enqueue(
          client,
          owner,
          "regenerate",
          resource,
          { revision: 1, taskId: "task-1" },
          key,
        ),
        first,
      );
      for (const [kind, target, body] of [
        ["regenerate", resource, { taskId: "task-2", revision: 1 }],
        ["regenerate", resource, { taskId: "task-1", revision: 2 }],
        ["regenerate", randomUUID(), payload],
        ["export", resource, payload],
      ] as const)
        await assert.rejects(enqueue(client, owner, kind, target, body, key), {
          code: "CONFLICT",
          status: 409,
        });
      assert.notEqual(
        await enqueue(client, other, "regenerate", resource, payload, key),
        first,
      );
      const accountKey = `delete:account:${owner}`;
      const cleanup = await enqueue(
        client,
        owner,
        "delete",
        randomUUID(),
        { scope: "account" },
        accountKey,
      );
      assert.equal(
        await enqueue(
          client,
          owner,
          "delete",
          randomUUID(),
          { scope: "account" },
          accountKey,
        ),
        cleanup,
      );
      throw rollback;
    }),
    (error) => error === rollback,
  );
  console.log(
    JSON.stringify({
      scope:
        "Real local PostgreSQL; all synthetic fixtures rolled back before workers can see them",
      equivalentPayloadReusesJob: true,
      changedTaskRevisionResourceOrKindRejected: true,
      ownersIsolated: true,
      accountCleanupRemainsIdempotent: true,
    }),
  );
} finally {
  await db().end();
}
