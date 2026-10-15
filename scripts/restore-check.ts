import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { db } from "../apps/web/lib/db";
import { env } from "../apps/web/lib/env";
function run(args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (b) => chunks.push(b));
    const errors: Buffer[] = [];
    child.stderr.on("data", (data) => errors.push(data));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(
            new Error(
              `Backup/restore command failed (${args[0]}): ${Buffer.concat(errors).toString().slice(-1500)}`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}
const name = `ziyatai_restore_${randomBytes(6).toString("hex")}`;
const started = Date.now();
await mkdir(".local/backups", { recursive: true });
const tables = [
  "user",
  "session",
  "account",
  "verification",
  "profiles",
  "uploads",
  "plans",
  "plan_versions",
  "generations",
  "generation_versions",
  "exports",
  "jobs",
  "usage_ledger",
  "schema_migrations",
];
async function fingerprint(connection: Pool | PoolClient) {
  const result: Record<string, { rows: number; sha256: string }> = {};
  for (const table of tables) {
    const records = (
      await connection.query(
        `SELECT to_jsonb(t)::text AS record FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`,
      )
    ).rows;
    const hash = createHash("sha256");
    for (const row of records) hash.update(row.record + "\n");
    result[table] = { rows: records.length, sha256: hash.digest("hex") };
  }
  return result;
}
const snapshot = await db().connect();
let baseline: Awaited<ReturnType<typeof fingerprint>>;
let bytes: Buffer;
try {
  await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshotId = (await snapshot.query("SELECT pg_export_snapshot() AS id"))
    .rows[0].id;
  baseline = await fingerprint(snapshot);
  bytes = await run([
    "exec",
    "ziyatai-local-postgres-1",
    "pg_dump",
    "-U",
    "ziyatai",
    "-d",
    "ziyatai",
    "-Fc",
    `--snapshot=${snapshotId}`,
  ]);
  await snapshot.query("COMMIT");
} catch (error) {
  await snapshot.query("ROLLBACK");
  throw error;
} finally {
  snapshot.release();
}
await writeFile(".local/backups/restore-test.dump", bytes, { mode: 0o600 });
const testImage = process.env.RESTORE_TEST_IMAGE;
const targetContainer = testImage ? name : "ziyatai-local-postgres-1";
const targetDatabase = testImage ? "ziyatai" : name;
const environmentFile = `.local/${name}.env`;
let created = false;
let target: Pool | undefined;
try {
  const url = new URL(env().DATABASE_URL);
  if (testImage) {
    const password = randomBytes(32).toString("hex");
    await writeFile(
      environmentFile,
      `POSTGRES_USER=ziyatai\nPOSTGRES_DB=ziyatai\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 },
    );
    await run([
      "run",
      "-d",
      "--name",
      name,
      "--env-file",
      environmentFile,
      "-p",
      "127.0.0.1::5432",
      "--tmpfs",
      "/var/lib/postgresql:rw,size=512m",
      "--memory",
      "512m",
      testImage,
    ]);
    created = true;
    const ports = JSON.parse(
      (
        await run([
          "inspect",
          "--format",
          "{{json .NetworkSettings.Ports}}",
          name,
        ])
      ).toString(),
    );
    url.hostname = "127.0.0.1";
    url.port = ports["5432/tcp"][0].HostPort;
    url.username = "ziyatai";
    url.password = password;
    let ready = false;
    for (let i = 0; i < 45; i++) {
      try {
        await run([
          "exec",
          name,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "ziyatai",
          "-d",
          "ziyatai",
        ]);
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!ready) throw new Error("Test PostgreSQL did not become ready");
  } else {
    await db().query(`CREATE DATABASE "${name}"`);
    created = true;
  }
  await run(
    [
      "exec",
      "-i",
      targetContainer,
      "pg_restore",
      "-U",
      "ziyatai",
      "-d",
      targetDatabase,
      "--no-owner",
      "--exit-on-error",
    ],
    await readFile(".local/backups/restore-test.dump"),
  );
  url.pathname = "/" + targetDatabase;
  target = new Pool({ connectionString: url.toString() });
  const search = (
    await target.query(
      "SELECT 'АЛГОРИТМ' ILIKE '%алгоритм%' AS ru, 'ӘҒҚҢӨҰҮҺІ' ILIKE 'әғқңөұүһі' AS kk",
    )
  ).rows[0];
  if (!search.ru || !search.kk)
    throw new Error("Cyrillic/Kazakh case-insensitive search changed");
  const actual = await fingerprint(target);
  for (const table of tables)
    if (
      actual[table].rows !== baseline[table].rows ||
      actual[table].sha256 !== baseline[table].sha256
    )
      throw new Error(`Restored table content does not match: ${table}`);
  const report = {
    environment: "local PostgreSQL container",
    ...(testImage
      ? { targetImage: testImage, originalDatabaseUnchanged: true }
      : {}),
    date: new Date().toISOString().slice(0, 10),
    backupBytes: bytes.length,
    sourceVersions: baseline.plan_versions.rows,
    restoredVersions: actual.plan_versions.rows,
    consistentSnapshot: true,
    contentHashesMatch: true,
    unicodeSearchVerified: true,
    tables: tables.map((table) => ({ table, rows: actual[table].rows })),
    durationMs: Date.now() - started,
    verified: true,
    limits:
      "This verifies local restore, not production backup scheduling or storage encryption",
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    testImage
      ? "docs/reports/postgres-image-restore.json"
      : "docs/reports/restore.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await target?.end();
  if (!/^ziyatai_restore_[a-f0-9]{12}$/.test(name))
    throw new Error("Invalid restore database name");
  if (created) {
    if (testImage) await run(["rm", "-f", name]);
    else await db().query(`DROP DATABASE "${name}"`);
  }
  await unlink(environmentFile).catch(() => {});
  await db().end();
}
