import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { grantRuntimeAccess } from "../supabase/runtime-role";
import { backfillPlanGrades } from "../data-migrations/plan-grades";
import { env } from "../../apps/web/lib/env";
// DDL and backfills have a separate, explicitly bounded maintenance budget.
// Runtime queries keep their short deadlines.
const pool = new Pool({
  ...databaseConnection({
    ...env(),
    DATABASE_URL: process.env.MIGRATION_DATABASE_URL || env().DATABASE_URL,
  }),
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 330000,
});
const c = await pool.connect();
try {
  await c.query(
    "SET statement_timeout='5min'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='30s'",
  );
  const schema = env().DATABASE_SCHEMA;
  if (schema === "public")
    throw new Error(
      "Supabase application tables require a private DATABASE_SCHEMA",
    );
  if (schema !== "public") {
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await c.query(`SET search_path TO "${schema}", public`);
  }
  await c.query("SELECT pg_advisory_lock(843001)");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`migrations/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const old = await c.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (old.rowCount) {
      if (old.rows[0].checksum !== checksum)
        throw new Error(`Migration modified: ${name}`);
      continue;
    }
    await c.query("BEGIN");
    try {
      await c.query(sql);
      if (name === "015_plan_grades.sql") await backfillPlanGrades(c);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await c.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }
  {
    if (schema === "public")
      throw new Error(
        "Supabase application tables require a private DATABASE_SCHEMA",
      );
    // Browser access goes through the server's ownership checks, never PostgREST.
    await c.query(`REVOKE ALL ON SCHEMA "${schema}" FROM anon, authenticated`);
    await c.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM anon, authenticated`,
    );
    await c.query(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${schema}" FROM anon, authenticated`,
    );
    const tables = await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1",
      [schema],
    );
    for (const { tablename } of tables.rows) {
      const table = String(tablename).replaceAll('"', '""');
      await c.query(
        `ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
    await c.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL ON TABLES FROM anon, authenticated`,
    );
  }
  if (process.env.RUNTIME_DATABASE_ROLE)
    await grantRuntimeAccess(c, schema, process.env.RUNTIME_DATABASE_ROLE);
} finally {
  await c.query("SELECT pg_advisory_unlock(843001)");
  c.release();
  await pool.end();
}
