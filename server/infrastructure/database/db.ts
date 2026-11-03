import { Pool, type PoolClient } from "pg";
import { env } from "../../config/env";
import { databaseConnection } from "./database-connection";
const globalDb = globalThis as unknown as { ziyataiPool?: Pool };
export function db() {
  if (globalDb.ziyataiPool) return globalDb.ziyataiPool;
  const pool = new Pool({
    ...databaseConnection(env()),
    max: env().DATABASE_POOL_MAX ?? 10,
    options: `-c search_path=${env().DATABASE_SCHEMA ?? "public"},public`,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });
  // pg emits errors for idle connections outside a request's try/catch.
  // Keep the process alive; never log connection strings or server messages.
  pool.on("error", () => {
    console.error(JSON.stringify({ event: "database_idle_connection_failed" }));
  });
  globalDb.ziyataiPool = pool;
  return pool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const c = await db().connect();
  let discard = false;
  let connectionError: Error | undefined;
  const disconnected = (error: Error) => {
    connectionError = error;
    discard = true;
  };
  // Checked-out clients no longer have pg-pool's idle error listener.
  c.on("error", disconnected);
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    if (connectionError) throw connectionError;
    await c.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      // A connection whose transaction state is unknown must not be reused.
      discard = true;
    }
    throw e;
  } finally {
    c.release(discard);
    c.off("error", disconnected);
  }
}
