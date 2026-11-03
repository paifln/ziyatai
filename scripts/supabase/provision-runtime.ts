import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { readEnvFile, writeEnvFile } from "../lib/env-file.mjs";
import { identifier } from "./migration-config";
import { grantRuntimeAccess } from "./runtime-role";

const input = process.argv[2],
  output = process.argv[3];
if (!input || !output || input === output || !process.argv.includes("--apply"))
  throw new Error(
    "Usage: tsx scripts/supabase/provision-runtime.ts ADMIN_ENV NEW_RUNTIME_ENV --apply (after migrations)",
  );
const values = await readEnvFile(input);
const role = "ziyatai_runtime";
const pool = new Pool({
  ...databaseConnection({
    DATABASE_URL: values.DATABASE_URL,
    DATABASE_SSL_CA: values.DATABASE_SSL_CA,
  }),
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 60000,
});
const c = await pool.connect();
try {
  await c.query("BEGIN");
  const existing = await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
    role,
  ]);
  if (existing.rowCount)
    throw new Error(
      "Runtime role already exists; verify its ownership and credentials before rotating it",
    );
  const password = randomBytes(32).toString("hex");
  // Password is generated hex, never caller-supplied or printed.
  await c.query(
    `CREATE ROLE ${identifier(role)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`,
  );
  await grantRuntimeAccess(c, values.DATABASE_SCHEMA || "ziyatai", role);
  const url = new URL(values.DATABASE_URL);
  const username = decodeURIComponent(url.username);
  url.username = username.includes(".")
    ? `${role}.${username.split(".").slice(1).join(".")}`
    : role;
  url.password = password;
  const runtime: Record<string, string> = {
    ...values,
    DATABASE_URL: url.toString(),
  };
  delete runtime.MIGRATION_DATABASE_URL;
  delete runtime.BACKUP_ENCRYPTION_KEY;
  // Persist before commit: a filesystem failure rolls back role creation.
  await writeEnvFile(output, runtime);
  await c.query("COMMIT");
  console.log(
    "Scoped runtime role provisioned; credentials saved privately. Keep the administrative file only for maintenance.",
  );
} catch {
  await c.query("ROLLBACK");
  console.error(
    "Runtime role provisioning failed; no credentials were logged.",
  );
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
