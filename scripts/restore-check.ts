import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
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
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error("Backup/restore command failed")),
    );
    child.stdin.end(input);
  });
}
const name = `ziyatai_restore_${randomBytes(6).toString("hex")}`;
const started = Date.now();
await mkdir(".local/backups", { recursive: true });
const baseline = (
  await db().query("SELECT count(*)::int AS plans FROM plan_versions")
).rows[0].plans;
const bytes = await run([
  "exec",
  "ziyatai-local-postgres-1",
  "pg_dump",
  "-U",
  "ziyatai",
  "-d",
  "ziyatai",
  "-Fc",
]);
await writeFile(".local/backups/restore-test.dump", bytes, { mode: 0o600 });
await db().query(`CREATE DATABASE "${name}"`);
let target: Pool | undefined;
try {
  await run(
    [
      "exec",
      "-i",
      "ziyatai-local-postgres-1",
      "pg_restore",
      "-U",
      "ziyatai",
      "-d",
      name,
      "--no-owner",
    ],
    await readFile(".local/backups/restore-test.dump"),
  );
  const url = new URL(env().DATABASE_URL);
  url.pathname = "/" + name;
  target = new Pool({ connectionString: url.toString() });
  const actual = (
    await target.query("SELECT count(*)::int AS plans FROM plan_versions")
  ).rows[0].plans;
  if (actual !== baseline) throw new Error("Restored count does not match");
  const report = {
    environment: "local PostgreSQL container",
    date: "2026-10-14",
    backupBytes: bytes.length,
    sourceVersions: baseline,
    restoredVersions: actual,
    durationMs: Date.now() - started,
    verified: true,
    limits:
      "This verifies local restore, not production backup scheduling or storage encryption",
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile("docs/reports/restore.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await target?.end();
  if (!/^ziyatai_restore_[a-f0-9]{12}$/.test(name))
    throw new Error("Invalid restore database name");
  await db().query(`DROP DATABASE "${name}"`);
  await db().end();
}
