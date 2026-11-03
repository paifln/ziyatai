import { databaseSnapshot } from "./database-snapshot";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readEnvFile } from "../lib/env-file.mjs";
import { objectStore } from "../supabase/migration-config";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { backupKey, encryptBackup } from "./backup-crypto";

const [input, output, maintenance] = process.argv.slice(2);
if (!input || !output || !["--maintenance", "--online"].includes(maintenance))
  throw new Error(
    "Usage: tsx scripts/ops/backup.ts PRIVATE_ENV NEW_BACKUP_DIR --maintenance|--online",
  );
const values = await readEnvFile(input),
  key = backupKey(values.BACKUP_ENCRYPTION_KEY);
const schema = values.DATABASE_SCHEMA || "ziyatai";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid schema");
await mkdir(output, { mode: 0o700 });
const pool = new Pool({
  ...databaseConnection({
    DATABASE_URL: values.DATABASE_URL,
    DATABASE_SSL_CA: values.DATABASE_SSL_CA,
  }),
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 150000,
});
try {
  if (
    (
      await pool.query(
        `SELECT 1 FROM "${schema}".jobs WHERE status IN ('queued','running') LIMIT 1`,
      )
    ).rowCount
  )
    throw new Error("Pending jobs; finish maintenance preparation");
  const client = await pool.connect();
  const referenced = new Map<string, string | undefined>();
  let tables: string[] = [];
  let inventory: {
    table: string;
    columns: string[];
    count: string;
    digest: string;
  }[] = [];
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout='60s'");
    const snapshot = await databaseSnapshot(client, schema, referenced);
    tables = snapshot.tables;
    inventory = snapshot.inventory;
    await encryptBackup(
      snapshot.stream,
      join(output, "database.rows.enc"),
      key,
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        event: "backup_database_encrypted",
        tables: tables.length,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const store = objectStore(values),
    objects: {
      key: string;
      file: string;
      bytes: number | null;
      checksum: string;
      sourceChecksumMismatch: boolean;
    }[] = [];
  await mkdir(join(output, "objects"), { mode: 0o700 });
  let cursor: string | undefined;
  do {
    const page = await store.send(
      new ListObjectsV2Command({
        Bucket: values.STORAGE_BUCKET,
        MaxKeys: 1000,
        ContinuationToken: cursor,
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    for (const object of page.Contents || []) {
      if (!object.Key) continue;
      const expected = referenced.get(object.Key);
      const file =
        createHash("sha256").update(object.Key).digest("hex") + ".enc";
      const body = await store.send(
        new GetObjectCommand({
          Bucket: values.STORAGE_BUCKET,
          Key: object.Key,
          IfMatch: object.ETag,
        }),
        { abortSignal: AbortSignal.timeout(120000) },
      );
      if (!(body.Body instanceof Readable))
        throw new Error("Unsupported storage stream");
      const checksum = await encryptBackup(
        body.Body,
        join(output, "objects", file),
        key,
      );
      const sourceChecksumMismatch = !!expected && checksum !== expected;
      referenced.delete(object.Key);
      objects.push({
        key: object.Key,
        file,
        bytes: body.ContentLength ?? null,
        checksum,
        sourceChecksumMismatch,
      });
    }
    cursor = page.NextContinuationToken;
  } while (cursor);
  if (referenced.size)
    throw new Error("Referenced objects missing from backup");
  const migrations = await Promise.all(
    (await readdir("migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map(async (name) => ({
        name,
        sql: await readFile(`migrations/${name}`, "utf8"),
      })),
  );
  await encryptBackup(
    Readable.from([JSON.stringify(migrations)]),
    join(output, "migrations.enc"),
    key,
  );
  await encryptBackup(
    Readable.from([
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        schema,
        tables,
        inventory,
        databaseFormat: "exact-postgres-row-json-lines",
        objects,
        integrityWarnings: objects.filter(
          (object) => object.sourceChecksumMismatch,
        ).length,
        scope:
          "application schema and bucket; Supabase Auth backup is managed separately",
      }),
    ]),
    join(output, "manifest.enc"),
    key,
  );
  await writeFile(
    join(output, "COMPLETE"),
    "Encrypted database and object backup completed. Restore rehearsal remains required.\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Encrypted application backup completed. Keep the encryption key separately and rehearse restoration.",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const known = [
    "Pending jobs; finish maintenance preparation",
    "Referenced objects missing from backup",
    "Unsupported circular dependencies",
    "Query read timeout",
  ];
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^[A-Z0-9_]{1,32}$/.test(String(error.code))
      ? String(error.code)
      : undefined;
  console.error(
    JSON.stringify({
      event: "backup_failed",
      reason: known.includes(message) ? message : "DEPENDENCY_FAILURE",
      code,
    }),
  );
  console.error(
    "Backup incomplete; do not use it as a recovery point. No credentials were logged.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
