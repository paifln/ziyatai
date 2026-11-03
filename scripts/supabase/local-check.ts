import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { identifier } from "./migration-config";

// Synthetic integration check in two temporary schemas; no application rows change.
const connection = process.env.DATABASE_URL;
if (
  !connection ||
  !["127.0.0.1", "localhost"].includes(new URL(connection).hostname)
)
  throw new Error("This integration check requires a local database");
const suffix = randomUUID().replaceAll("-", "");
const source = `supabase_test_source_${suffix}`,
  target = `supabase_test_target_${suffix}`;
const files = [
  resolve(`.local/${source}.env`),
  resolve(`.local/${target}.env`),
];
const pool = new Pool({ connectionString: connection, max: 1 });
async function run(
  script: string,
  args: string[] = [],
  overrides: Record<string, string> = {},
) {
  await new Promise<void>((done, fail) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, ...args],
      {
        env: {
          ...process.env,
          APP_ENV: "local",
          ...overrides,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let failedOutput = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      failedOutput += String(chunk);
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? done()
        : fail(
            new Error(
              `Integration subprocess failed (${script}); inspect script locally. ${failedOutput.includes("Data verification failed") ? "Data verification failed." : ""}`,
            ),
          ),
    );
  });
}
try {
  await mkdir(".local", { recursive: true });
  for (const name of [source, target])
    await run("scripts/runtime/migrate.ts", [], { DATABASE_SCHEMA: name });
  await writeFile(
    files[0],
    `DATABASE_URL=${JSON.stringify(connection)}\nDATABASE_SCHEMA=${source}\n`,
  );
  await writeFile(
    files[1],
    `DATABASE_URL=${JSON.stringify(connection)}\nDATABASE_SCHEMA=${target}\n`,
  );
  const owner = randomUUID(),
    upload = randomUUID(),
    plan = randomUUID(),
    version = randomUUID(),
    row = randomUUID();
  const c = await pool.connect();
  try {
    await c.query(`SET search_path TO ${identifier(source)},public`);
    await c.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","teachingSubject") VALUES($1,$2,$3,true,$4)',
      [
        owner,
        "Әлия Ғалымқызы",
        "synthetic-migration@example.test",
        "mathematics",
      ],
    );
    await c.query("INSERT INTO profiles(owner_id) VALUES($1)", [owner]);
    await c.query(
      "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status) VALUES($1,$2,$3,$4,'application/pdf',3,'synthetic','clean')",
      [upload, owner, `${owner}/synthetic.pdf`, "Қазақша.pdf"],
    );
    await c.query(
      "INSERT INTO plans(id,owner_id,file_id,title,grade,grades) VALUES($1,$2,$3,$4,7,ARRAY[7])",
      [plan, owner, upload, "КТЖ — тексеру"],
    );
    await c.query(
      "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version) VALUES($1,$2,1,$3,'synthetic')",
      [
        version,
        plan,
        JSON.stringify([
          {
            id: row,
            sourceOrder: 1,
            topic: "Жай бөлшектер",
            goals: "Бөлшектерді қосу",
            dateRaw: "02.11.2026",
            dateStart: "2026-11-02",
            dateEnd: "",
          },
        ]),
      ],
    );
  } finally {
    c.release();
  }
  const args = ["--source-env", files[0], "--target-env", files[1]];
  await run("scripts/supabase/copy-database.ts", args);
  await run("scripts/supabase/copy-database.ts", [
    ...args,
    "--apply",
    "--maintenance",
  ]);
  // A second apply must refuse existing target rows, preserving their contents.
  let refused = false;
  try {
    await run("scripts/supabase/copy-database.ts", [
      ...args,
      "--apply",
      "--maintenance",
    ]);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error("Migration overwrote a populated target");
  process.env.DATABASE_SCHEMA = target;
  const { provisionIdentity, readIdentity } =
    await import("../../server/auth/identity");
  const { db } = await import("../../server/infrastructure/database/db");
  const user = {
    id: randomUUID(),
    email: "SYNTHETIC-MIGRATION@example.test",
    email_confirmed_at: new Date().toISOString(),
  };
  const session = randomUUID();
  try {
    const mapped = await provisionIdentity(
      user as Parameters<typeof provisionIdentity>[0],
      session,
      { name: "Must not overwrite old name" },
      true,
    );
    const identity = await readIdentity(
      user as Parameters<typeof readIdentity>[0],
      session,
    );
    if (mapped !== owner || identity.name !== "Әлия Ғалымқызы")
      throw new Error("Existing owner mapping was not preserved");
    await db().query("UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", [
      session,
    ]);
    if (await readIdentity(user as Parameters<typeof readIdentity>[0], session))
      throw new Error("Revoked session was accepted");
  } finally {
    await db().end();
  }
  console.log(
    "Passed: isolated migrations, data copy, Unicode/date/JSON verification, populated-target refusal, existing-owner linking and immediate session revocation.",
  );
} finally {
  for (const name of [source, target]) {
    if (!/^supabase_test_(source|target)_[a-f0-9]{32}$/.test(name))
      throw new Error("Unsafe integration schema cleanup");
    await pool.query(`DROP SCHEMA IF EXISTS ${identifier(name)} CASCADE`);
  }
  await pool.end();
  for (const file of files) await rm(file, { force: true });
}
