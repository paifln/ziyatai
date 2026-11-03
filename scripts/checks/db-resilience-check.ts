import assert from "node:assert/strict";
import type { EventEmitter } from "node:events";
import { Pool } from "pg";
import { db, transaction } from "../../apps/web/lib/db";
import { env } from "../../apps/web/lib/env";

const settings = env();
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(settings.DATABASE_URL).hostname,
  )
)
  throw new Error(
    "Database resilience check is restricted to a local database",
  );

const pool = db();
const control = new Pool({
  connectionString: settings.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
});
control.on("error", () => {});

function disconnected(emitter: EventEmitter) {
  let timer: NodeJS.Timeout;
  const promise = new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    emitter.once("error", done);
    timer = setTimeout(() => {
      emitter.off("error", done);
      reject(new Error("Synthetic connection termination was not observed"));
    }, 5000);
  });
  return promise;
}

try {
  const client = await pool.connect();
  const pid = (
    await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
  ).rows[0].pid;
  client.release();
  const idleLost = disconnected(pool);
  // Only terminate the connection created by this script, never another worker.
  await control.query("SELECT pg_terminate_backend($1)", [pid]);
  await idleLost;
  assert.equal((await pool.query("SELECT 1 AS value")).rows[0].value, 1);

  const original = new Error("Synthetic operation failure");
  await assert.rejects(
    transaction(async (connection) => {
      const ownPid = (
        await connection.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows[0].pid;
      const lost = disconnected(connection);
      await control.query("SELECT pg_terminate_backend($1)", [ownPid]);
      await lost;
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal(
    (await transaction((connection) => connection.query("SELECT 1 AS value")))
      .rows[0].value,
    1,
  );
  console.log(
    JSON.stringify({
      scope:
        "Own synthetic connections in the configured local PostgreSQL; no application data written",
      idleDisconnectSurvived: true,
      checkedOutDisconnectSurvived: true,
      originalFailurePreserved: true,
      poolRecovered: true,
    }),
  );
} finally {
  await Promise.all([control.end(), pool.end()]);
}
