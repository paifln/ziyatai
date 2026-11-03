/** Replace conservative legacy export reservations only from a verified archive. */
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readEnvFile } from "../lib/env-file.mjs";
import { backupKey, openBackupStream } from "./backup-crypto";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { identifier } from "../supabase/migration-config";
const [input, folder] = process.argv.slice(2);
if (!input || !folder)
  throw new Error(
    "Usage: tsx scripts/ops/backfill-export-budgets.ts PRIVATE_ENV VERIFIED_BACKUP_DIR",
  );
await readFile(join(folder, "COMPLETE"));
const values = await readEnvFile(input),
  source = await openBackupStream(
    join(folder, "manifest.enc"),
    backupKey(values.BACKUP_ENCRYPTION_KEY),
  );
let text = "";
for await (const chunk of source.stream) {
  text += chunk;
  if (text.length > 8 * 1024 * 1024) throw new Error("Manifest exceeds budget");
}
await source.verified;
const manifest = JSON.parse(text);
const schema = identifier(values.DATABASE_SCHEMA || "ziyatai");
const pool = new Pool({
  ...databaseConnection({
    DATABASE_URL: values.DATABASE_URL,
    DATABASE_SSL_CA: values.DATABASE_SSL_CA,
  }),
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 30000,
});
const c = await pool.connect();
try {
  await c.query("BEGIN");
  let changed = 0;
  const objects = manifest.objects.filter(
    (o: { bytes: number; checksum: string; sourceChecksumMismatch: boolean }) =>
      Number.isSafeInteger(o.bytes) &&
      o.bytes >= 0 &&
      o.bytes <= 33554432 &&
      /^[a-f0-9]{64}$/.test(o.checksum) &&
      !o.sourceChecksumMismatch,
  );
  for (let index = 0; index < objects.length; index += 100) {
    const rows = objects
      .slice(index, index + 100)
      .map((o: { key: string; bytes: number; checksum: string }) => ({
        key: o.key,
        bytes: o.bytes,
        checksum: o.checksum,
      }));
    const result = await c.query(
      `UPDATE ${schema}.exports e SET budget_bytes=o.bytes FROM jsonb_to_recordset($1::jsonb) AS o(key text,bytes bigint,checksum text) WHERE e.object_key=o.key AND e.checksum=o.checksum AND e.status='succeeded' AND e.budget_bytes<>o.bytes`,
      [JSON.stringify(rows)],
    );
    changed += result.rowCount || 0;
  }
  await c.query("COMMIT");
  console.log(
    JSON.stringify({ event: "export_budget_backfill", updated: changed }),
  );
} catch {
  await c.query("ROLLBACK");
  console.error(
    "Export budget backfill failed and rolled back; no credentials were logged.",
  );
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
