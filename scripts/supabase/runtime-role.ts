import type { PoolClient } from "pg";
import { identifier } from "./migration-config";

// Server-only role: application ownership checks remain authoritative. Never
// grant access to provider auth tables or obsolete password/token tables.
const tables = [
  "user",
  "profiles",
  "uploads",
  "plans",
  "plan_versions",
  "ktp_rows",
  "generations",
  "generation_versions",
  "exports",
  "jobs",
  "usage_ledger",
  "audit",
  "api_limits",
  "worker_health",
  "api_read_budgets",
  "editor_drafts",
  "auth_session_read_budgets",
  "auth_identities",
  "auth_sessions",
  "resource_budgets",
];
export async function grantRuntimeAccess(
  c: PoolClient,
  namespace: string,
  role: string,
) {
  const schema = identifier(namespace),
    target = identifier(role);
  await c.query(`GRANT USAGE ON SCHEMA ${schema} TO ${target}`);
  for (const table of tables) {
    const qualified = `${schema}.${identifier(table)}`;
    await c.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ${qualified} TO ${target}`,
    );
    await c.query(
      `DROP POLICY IF EXISTS runtime_service_access ON ${qualified}`,
    );
    await c.query(
      `CREATE POLICY runtime_service_access ON ${qualified} TO ${target} USING (true) WITH CHECK (true)`,
    );
  }
  await c.query(
    `GRANT EXECUTE ON FUNCTION ${schema}.resource_size(jsonb,text) TO ${target}`,
  );
  await c.query(`ALTER ROLE ${target} SET statement_timeout='5s'`);
  await c.query(`ALTER ROLE ${target} SET lock_timeout='1s'`);
  await c.query(
    `ALTER ROLE ${target} SET idle_in_transaction_session_timeout='10s'`,
  );
}
