/** Transactional SQL regression on an isolated schema; all changes roll back. */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { readEnvFile } from "../lib/env-file.mjs";
import { grantRuntimeAccess } from "../supabase/runtime-role";

const values = await readEnvFile(process.argv[2] || ".env.local");
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
const suffix = randomUUID().replaceAll("-", "");
const schema = `budget_test_${suffix}`,
  role = `budget_role_${suffix}`;
try {
  await c.query("BEGIN");
  await c.query(
    `CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public; SET LOCAL statement_timeout='30s'`,
  );
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await c.query(await readFile(`migrations/${name}`, "utf8"));
  const owner = randomUUID(),
    plan = randomUUID(),
    upload = randomUUID();
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
    owner,
    "Synthetic",
    `${owner}@example.test`,
  ]);
  await c.query(
    "INSERT INTO plans(id,owner_id,title) VALUES($1,$2,'Synthetic')",
    [plan, owner],
  );
  const insertVersion = () =>
    c.query(
      "INSERT INTO plan_versions(id,plan_id,revision,parser_version) VALUES($1,$2,1,'synthetic') ON CONFLICT(plan_id,revision) DO NOTHING",
      [randomUUID(), plan],
    );
  await insertVersion();
  const balance = async () =>
    BigInt(
      (
        await c.query("SELECT bytes FROM resource_budgets WHERE owner_id=$1", [
          owner,
        ])
      ).rows[0].bytes,
    );
  const initial = await balance();
  assert(initial > 0n);
  await insertVersion();
  assert.equal(
    await balance(),
    initial,
    "idempotent version insertion must not double charge",
  );
  await c.query(
    "INSERT INTO plan_versions(id,plan_id,revision,parser_version) SELECT gen_random_uuid(),$1,n,'synthetic' FROM generate_series(2,200) n",
    [plan],
  );
  await c.query("SAVEPOINT version_limit");
  await assert.rejects(
    c.query(
      "INSERT INTO plan_versions(id,plan_id,revision,parser_version) VALUES(gen_random_uuid(),$1,201,'synthetic')",
      [plan],
    ),
    { code: "P0001", message: "RESOURCE_LIMIT" },
  );
  await c.query("ROLLBACK TO SAVEPOINT version_limit");
  await c.query("DELETE FROM plans WHERE id=$1", [plan]);
  assert.equal(await balance(), 0n, "cascades release all version bytes");
  await c.query(
    "UPDATE resource_budgets SET bytes=1073741823 WHERE owner_id=$1",
    [owner],
  );
  await c.query(
    "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status) VALUES($1,$2,'synthetic','fixture.pdf','application/pdf',1,'','clean')",
    [upload, owner],
  );
  assert.equal(await balance(), 1073741824n);
  await c.query("SET LOCAL search_path=public");
  await c.query(
    `UPDATE ${schema}.uploads SET original_name='Renamed fixture' WHERE id=$1`,
    [upload],
  );
  await c.query(`SET LOCAL search_path=${schema},public`);
  await c.query("SAVEPOINT byte_limit");
  await assert.rejects(
    c.query(
      "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status) VALUES(gen_random_uuid(),$1,'overflow','fixture.pdf','application/pdf',1,'','clean')",
      [owner],
    ),
    { code: "P0001", message: "RESOURCE_LIMIT" },
  );
  await c.query("ROLLBACK TO SAVEPOINT byte_limit");
  await c.query("DELETE FROM uploads WHERE id=$1", [upload]);
  assert.equal(await balance(), 1073741823n);
  await c.query(
    `CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  for (const { tablename } of (
    await c.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [
      schema,
    ])
  ).rows)
    await c.query(
      `ALTER TABLE ${schema}."${String(tablename).replaceAll('"', '""')}" ENABLE ROW LEVEL SECURITY`,
    );
  await grantRuntimeAccess(c, schema, role);
  await c.query(`GRANT ${role} TO CURRENT_USER`);
  const authUsers = (await c.query("SELECT 'auth.users'::regclass::oid AS id"))
    .rows[0].id;
  await c.query("UPDATE resource_budgets SET bytes=0 WHERE owner_id=$1", [
    owner,
  ]);
  await c.query(`SET LOCAL ROLE ${role}`);
  assert.equal(
    (await c.query('SELECT count(*)::int AS count FROM "user"')).rows[0].count,
    1,
  );
  const runtimePlan = randomUUID();
  await c.query(
    "INSERT INTO plans(id,owner_id,title) VALUES($1,$2,'Runtime fixture')",
    [runtimePlan, owner],
  );
  await c.query(
    "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version) VALUES(gen_random_uuid(),$1,1,$2,'synthetic')",
    [
      runtimePlan,
      JSON.stringify([
        {
          id: randomUUID(),
          sourceOrder: 1,
          topic: "Synthetic",
          goals: "Synthetic",
          dateRaw: "",
        },
      ]),
    ],
  );
  assert.equal(
    (await c.query("SELECT count(*)::int AS n FROM ktp_rows")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await c.query(
        "SELECT has_table_privilege(current_user,$1::oid,'UPDATE') AS allowed",
        [authUsers],
      )
    ).rows[0].allowed,
    false,
  );
  await c.query("RESET ROLE");
  console.log(
    "Resource quota, no double charge, version limit, cascade release and scoped runtime role: passed (rolled back).",
  );
} finally {
  await c.query("ROLLBACK");
  c.release();
  await pool.end();
}
