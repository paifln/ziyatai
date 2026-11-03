/** Restore only into a new transactional schema, verify all content, roll back. */
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { readEnvFile } from "../lib/env-file.mjs";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { identifier } from "../supabase/migration-config";
import { backupKey, openBackupStream } from "./backup-crypto";

const [input, folder] = process.argv.slice(2);
if (!input || !folder)
  throw new Error(
    "Usage: tsx scripts/ops/rehearse-restore.ts PRIVATE_ENV BACKUP_DIR",
  );
await readFile(join(folder, "COMPLETE"));
const values = await readEnvFile(input),
  key = backupKey(values.BACKUP_ENCRYPTION_KEY);
async function json(name: string) {
  const source = await openBackupStream(join(folder, name), key);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source.stream) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024)
      throw new Error("Backup metadata exceeds budget");
    chunks.push(Buffer.from(chunk));
  }
  await source.verified;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const manifest = await json("manifest.enc"),
  migrations = await json("migrations.enc");
const schema = identifier(`restore_test_${randomUUID().replaceAll("-", "")}`);
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
  await c.query(
    `CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public; SET LOCAL TIME ZONE 'UTC'; SET LOCAL statement_timeout='30s'`,
  );
  for (const migration of migrations) await c.query(migration.sql);
  for (const entry of manifest.inventory)
    await c.query(
      `ALTER TABLE ${schema}.${identifier(entry.table)} DISABLE TRIGGER USER`,
    );
  const source = await openBackupStream(join(folder, "database.rows.enc"), key);
  let table = "",
    documents: string[] = [];
  const flush = async () => {
    if (!documents.length) return;
    const t = `${schema}.${identifier(table)}`;
    let value = "e";
    if (table === "plan_versions" || table === "generation_versions") {
      const parent = table === "plan_versions" ? "plans" : "generations",
        id = table === "plan_versions" ? "plan_id" : "generation_id";
      value = `e || jsonb_build_object('budget_owner_id',(SELECT owner_id FROM ${schema}.${parent} WHERE id=(e->>'${id}')::uuid))`;
    } else if (table === "exports")
      value =
        "e || jsonb_build_object('budget_bytes',COALESCE((e->>'budget_bytes')::bigint,33554432))";
    await c.query(
      `INSERT INTO ${t} SELECT (jsonb_populate_record(NULL::${t},${value})).* FROM jsonb_array_elements($1::jsonb) e`,
      [`[${documents.join(",")}]`],
    );
    documents = [];
  };
  const lines = createInterface({ input: source.stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const row = JSON.parse(line);
    if (!manifest.tables.includes(row.table) || typeof row.row !== "string")
      throw new Error("Invalid snapshot table");
    if (table !== row.table) {
      await flush();
      table = row.table;
    }
    documents.push(row.row);
    if (documents.length >= 50) await flush();
  }
  await source.verified;
  await flush();
  for (const entry of manifest.inventory) {
    const columns = entry.columns.map(identifier).join(",");
    const got = (
      await c.query(
        `SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM (SELECT ${columns} FROM ${schema}.${identifier(entry.table)}) t`,
      )
    ).rows[0];
    if (got.count !== entry.count || got.digest !== entry.digest)
      throw new Error("Restored data fingerprint mismatch");
  }
  let files = 0;
  for (const object of manifest.objects) {
    if (!/^[a-f0-9]{64}\.enc$/.test(object.file))
      throw new Error("Invalid object archive path");
    const source = await openBackupStream(
      join(folder, "objects", object.file),
      key,
    );
    let bytes = 0;
    const hash = createHash("sha256");
    for await (const chunk of source.stream) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    await source.verified;
    if (object.checksum && hash.digest("hex") !== object.checksum)
      throw new Error("Object checksum mismatch");
    if (object.bytes !== null && bytes !== object.bytes)
      throw new Error("Object byte count mismatch");
    files++;
  }
  console.log(
    JSON.stringify({
      event: "restore_rehearsal",
      status: "passed",
      tables: manifest.inventory.length,
      objects: files,
      allRowFingerprintsMatched: true,
      sourceIntegrityWarnings: manifest.integrityWarnings || 0,
      changes: "rolled-back",
    }),
  );
} catch {
  console.error(
    "Restore rehearsal failed; temporary schema rolled back. No data or credentials were logged.",
  );
  process.exitCode = 1;
} finally {
  await c.query("ROLLBACK");
  c.release();
  await pool.end();
}
