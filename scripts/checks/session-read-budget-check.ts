import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { db } from "../../server/infrastructure/database/db";
import {
  consumeSessionRead,
  sessionReadPolicy,
} from "../../server/http/session-read-budget";

const keys: string[] = [];
const key = () => {
  const value = randomBytes(32).toString("hex");
  keys.push(value);
  return value;
};
const pool = db();
let report: Record<string, unknown> | undefined;
const step = 60 / sessionReadPolicy.perMinute;
const tolerance = (sessionReadPolicy.burst - 1) * step;
let locked: PoolClient | undefined;
try {
  const race = key();
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: 160 }, () => consumeSessionRead(race)),
  );
  const elapsed = performance.now() - started;
  const allowed = results.filter((r) => r.allowed).length;
  assert(allowed >= sessionReadPolicy.burst);
  assert(
    allowed <= sessionReadPolicy.burst + Math.ceil(elapsed / (step * 1000)) + 2,
  );
  assert(results.some((r) => !r.allowed));
  assert(
    (await consumeSessionRead(key())).allowed,
    "A different network must retain its own budget",
  );

  const blocked = key();
  await pool.query(
    "INSERT INTO auth_session_read_budgets(key,available_at) VALUES($1,statement_timestamp()+$2::double precision*interval '1 second')",
    [blocked, tolerance + 10],
  );
  const before = (
    await pool.query(
      "SELECT available_at::text AS value FROM auth_session_read_budgets WHERE key=$1",
      [blocked],
    )
  ).rows[0].value;
  const denied = await Promise.all(
    Array.from({ length: 10 }, () => consumeSessionRead(blocked)),
  );
  assert(
    denied.every((r) => !r.allowed && r.retryAfter >= 1 && r.retryAfter <= 10),
  );
  const after = (
    await pool.query(
      "SELECT available_at::text AS value FROM auth_session_read_budgets WHERE key=$1",
      [blocked],
    )
  ).rows[0].value;
  assert.equal(after, before, "Refusal must not move the admission clock");

  const stale = Array.from({ length: 80 }, key);
  await pool.query(
    "INSERT INTO auth_session_read_budgets(key,available_at) SELECT unnest($1::text[]),statement_timestamp()-interval '1 hour'",
    [stale],
  );
  locked = await pool.connect();
  await locked.query("BEGIN");
  const first = [...stale].sort()[0];
  await locked.query(
    "SELECT key FROM auth_session_read_budgets WHERE key=$1 FOR UPDATE",
    [first],
  );
  const current = key();
  await pool.query(
    "INSERT INTO auth_session_read_budgets(key,available_at) VALUES($1,statement_timestamp()-interval '1 hour')",
    [current],
  );
  assert(
    (await consumeSessionRead(current)).allowed,
    "An expired current row must renew without delete/insert ambiguity",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM auth_session_read_budgets WHERE key=ANY($1::text[])",
        [stale],
      )
    ).rows[0].n,
    48,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM auth_session_read_budgets WHERE key=$1",
        [first],
      )
    ).rows[0].n,
    1,
  );
  await locked.query("ROLLBACK");
  locked.release();
  locked = undefined;

  report = {
    date: new Date().toISOString(),
    policy: sessionReadPolicy,
    parallelRequests: results.length,
    accepted: allowed,
    rejected: results.length - allowed,
    elapsedMs: Math.round(elapsed),
    separateNetworkAvailable: true,
    refusedReadsPreserveSchedule: true,
    prunedExpiredRows: 32,
    lockedRowSkipped: true,
    expiredCurrentRowRenewed: true,
    syntheticRowsRemoved: true,
  };
} finally {
  if (locked) {
    await locked.query("ROLLBACK");
    locked.release();
  }
  await pool.query(
    "DELETE FROM auth_session_read_budgets WHERE key=ANY($1::text[])",
    [keys],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM auth_session_read_budgets WHERE key=ANY($1::text[])",
        [keys],
      )
    ).rows[0].n,
    0,
  );
  await pool.end();
}
assert(report);
await mkdir(".local/reports", { recursive: true });
await writeFile(
  ".local/reports/session-read-budget-db.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
