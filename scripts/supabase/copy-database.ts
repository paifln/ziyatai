import { Pool } from "pg";
import { databaseConnection } from "../../server/infrastructure/database/database-connection";
import {
  identifier as quote,
  migrationArguments,
  schema,
  settings,
} from "./migration-config";

// A single consistent source snapshot and one atomic target transaction.
// Defaults to read-only inventory. Never overwrites a populated destination.
const args = migrationArguments();
const source = await settings(args.source),
  target = await settings(args.target);
const from = schema(source),
  to = schema(target);
if (source.DATABASE_URL === target.DATABASE_URL && from === to)
  throw new Error("Source and destination must differ");
const sourcePool = new Pool({
  ...databaseConnection({
    DATABASE_URL: source.DATABASE_URL,
    DATABASE_SSL_CA: source.DATABASE_SSL_CA,
  }),
  max: 1,
});
const targetPool = new Pool({
  ...databaseConnection({
    DATABASE_URL: target.DATABASE_URL,
    DATABASE_SSL_CA: target.DATABASE_SSL_CA,
  }),
  max: 1,
});
const src = await sourcePool.connect(),
  dst = await targetPool.connect();
try {
  await src.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await src.query("SET LOCAL TIME ZONE 'UTC'");
  await dst.query("BEGIN");
  await dst.query("SET LOCAL TIME ZONE 'UTC'");
  await dst.query(`SET LOCAL search_path TO ${quote(to)}, public`);
  const excluded = new Set([
    "schema_migrations",
    "session",
    "account",
    "verification",
    "rateLimit",
    "auth_identities",
    "auth_sessions",
    "api_limits",
    "api_read_budgets",
    "auth_session_read_budgets",
    "worker_health",
  ]);
  const catalog = await src.query(
    "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
    [from],
  );
  const tables: string[] = catalog.rows
    .map((row) => row.tablename)
    .filter((name) => !excluded.has(name));
  const dependencies = await src.query(
    `SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint c
     JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace n ON n.oid=child.relnamespace
     JOIN pg_class parent ON parent.oid=c.confrelid WHERE c.contype='f' AND n.nspname=$1`,
    [from],
  );
  const ordered: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter(
      (name) =>
        !dependencies.rows.some(
          (d) =>
            d.child === name && d.parent !== name && remaining.has(d.parent),
        ),
    );
    if (!ready.length)
      throw new Error(
        "Circular table dependencies require a dedicated migration",
      );
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
    }
  }
  if (args.apply) {
    const active = await src.query(
      `SELECT count(*)::int AS count FROM ${quote(from)}.jobs WHERE status IN ('queued','running')`,
    );
    if (active.rows[0].count)
      throw new Error("Finish or cancel pending jobs before database transfer");
    for (const table of ordered) {
      await dst.query(
        `LOCK TABLE ${quote(to)}.${quote(table)} IN ACCESS EXCLUSIVE MODE`,
      );
      const count = await dst.query(
        `SELECT count(*)::int AS count FROM ${quote(to)}.${quote(table)}`,
      );
      if (count.rows[0].count)
        throw new Error(`Destination table is not empty: ${table}`);
    }
  }
  for (const table of ordered) {
    const sourceTable = `${quote(from)}.${quote(table)}`,
      targetTable = `${quote(to)}.${quote(table)}`;
    const count = (
      await src.query(`SELECT count(*)::int AS count FROM ${sourceTable}`)
    ).rows[0].count;
    console.log(
      JSON.stringify({
        table,
        rows: count,
        mode: args.apply ? "copy" : "inventory",
      }),
    );
    // This SQL projection is recreated by the plan_versions INSERT trigger.
    if (!args.apply || table === "ktp_rows") continue;
    await src.query(
      `DECLARE migration_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS document FROM ${sourceTable} t`,
    );
    try {
      for (;;) {
        const batch = await src.query("FETCH FORWARD 250 FROM migration_rows");
        if (!batch.rowCount) break;
        let documents: string[] = [],
          size = 2;
        const flush = async () => {
          if (!documents.length) return;
          // Preserve SQL numeric precision and timestamps; never parse through JS.
          await dst.query(
            `INSERT INTO ${targetTable} SELECT * FROM json_populate_recordset(NULL::${targetTable},$1::json)`,
            [`[${documents.join(",")}]`],
          );
          documents = [];
          size = 2;
        };
        for (const row of batch.rows) {
          const bytes = Buffer.byteLength(row.document) + 1;
          if (bytes > 32 * 1024 * 1024)
            throw new Error("Database row exceeds transfer budget");
          if (size + bytes > 4 * 1024 * 1024) await flush();
          documents.push(row.document);
          size += bytes;
        }
        await flush();
      }
    } finally {
      await src.query("CLOSE migration_rows");
    }
  }
  if (args.apply) {
    for (const table of ordered) {
      const fingerprint = (prefix: string) =>
        `SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${quote(prefix)}.${quote(table)} t`;
      const before = (await src.query(fingerprint(from))).rows[0];
      const after = (await dst.query(fingerprint(to))).rows[0];
      if (before.count !== after.count || before.digest !== after.digest)
        throw new Error(`Data verification failed: ${table}`);
    }
    await dst.query("COMMIT");
    console.log(
      "Database copied and verified. Source preserved. Passwords and sessions were not transferred.",
    );
  } else await dst.query("ROLLBACK");
  await src.query("ROLLBACK");
} catch (error) {
  await dst.query("ROLLBACK").catch(() => {});
  await src.query("ROLLBACK").catch(() => {});
  // Do not print database error messages, SQL values or connection strings.
  console.error(
    error instanceof Error &&
      /^(Destination table|Data verification|Finish or cancel|Circular)/.test(
        error.message,
      )
      ? error.message
      : "Database transfer failed; destination transaction rolled back.",
  );
  process.exitCode = 1;
} finally {
  src.release();
  dst.release();
  await sourcePool.end();
  await targetPool.end();
}
