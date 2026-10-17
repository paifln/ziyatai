import { Pool } from "pg";
import { env } from "./env";
import { storageReady } from "./storage";

// One promise and one short-lived result per process, regardless of callers.
export function createReadinessProbe(
  check: () => Promise<boolean>,
  now: () => number = () => performance.now(),
) {
  let pending: Promise<boolean> | undefined;
  let cached = false;
  let expires = -Infinity;
  return () => {
    if (pending) return pending;
    if (now() < expires) return Promise.resolve(cached);
    pending = Promise.resolve()
      .then(check)
      .catch(() => false)
      .then((ready) => {
        cached = ready;
        expires = now() + 2000;
        pending = undefined;
        return ready;
      });
    return pending;
  };
}

// Probes cannot exhaust the business pool during a dependency outage.
const globalHealth = globalThis as unknown as { ziyataiHealthPool?: Pool };
function healthPool() {
  if (!globalHealth.ziyataiHealthPool) {
    const pool = new Pool({
      connectionString: env().DATABASE_URL,
      application_name: "ziyatai-readiness",
      max: 1,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
      statement_timeout: 2000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    // Idle connection failures are handled by the next bounded probe.
    pool.on("error", () => {});
    globalHealth.ziyataiHealthPool = pool;
  }
  return globalHealth.ziyataiHealthPool;
}
export const readiness = createReadinessProbe(async () => {
  const results = await Promise.allSettled([
    healthPool().query(
      "SELECT 1 FROM worker_health WHERE heartbeat>now()-interval '60 seconds' LIMIT 1",
    ),
    storageReady(AbortSignal.timeout(2000)),
  ]);
  return (
    results[0].status === "fulfilled" &&
    !!results[0].value.rowCount &&
    results[1].status === "fulfilled"
  );
});
