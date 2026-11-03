/** Explicit live regression: two owned synthetic accounts, no AI calls or emails. */
import { request, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { readEnvFile } from "../lib/env-file.mjs";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { syntheticDemo } from "../../packages/domain/demo";
import { identifier } from "../supabase/migration-config";

const [envFile, docxPath, output, live] = process.argv.slice(2);
if (!envFile || !docxPath || !output || live !== "--live")
  throw new Error(
    "Usage: tsx scripts/checks/release-smoke.ts RUNTIME_ENV DOCX_PATH REPORT_JSON --live",
  );
const values = await readEnvFile(envFile),
  origin = new URL(values.APP_URL).origin;
const pool = new Pool({
  ...databaseConnection({
    DATABASE_URL: values.DATABASE_URL,
    DATABASE_SSL_CA: values.DATABASE_SSL_CA,
  }),
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 10000,
});
const schema = identifier(values.DATABASE_SCHEMA || "ziyatai");
let phase = "starting";
const actors: { http: APIRequestContext; owner: string }[] = [];
const result: Record<string, unknown> = { aiCalls: 0, emailsSent: 0 };
async function post(
  http: APIRequestContext,
  path: string,
  data: unknown,
  key = randomUUID(),
) {
  return http.post(`${origin}/api/${path}`, {
    data,
    headers: { Origin: origin, "Idempotency-Key": key },
  });
}
async function waitJob(http: APIRequestContext, id: string) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const response = await http.get(`${origin}/api/jobs/${id}`);
    assert.equal(response.status(), 200);
    const job = await response.json();
    if (job.status === "succeeded") return job;
    if (["failed", "cancelled"].includes(job.status))
      throw new Error("Synthetic job failed");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Synthetic job timed out");
}
try {
  phase = "synthetic accounts";
  for (let index = 0; index < 2; index++) {
    const http = await request.newContext({ timeout: 30000 });
    const response = await post(http, "auth/sign-up/email", {
      email: `release-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("base64url") + "aA1!",
      name: "Synthetic release check",
      teachingSubject: "English Language",
    });
    assert.equal(response.status(), 200);
    const session = await (
      await http.get(`${origin}/api/auth/get-session`)
    ).json();
    assert(session?.user?.id);
    actors.push({ http, owner: session.user.id });
  }
  const [a, b] = actors;
  assert.equal((await a.http.get(`${origin}/api/profile`)).status(), 200);
  phase = "English DOCX upload";
  const bytes = await readFile(docxPath);
  const init = await post(a.http, "uploads/init", {
    name: "English Grade 3.docx",
    bytes: bytes.length,
  });
  assert.equal(init.status(), 201);
  const upload = await init.json();
  const put = await a.http.put(upload.url, {
    data: bytes,
    headers: { "Content-Type": upload.contentType, Origin: origin },
  });
  assert(put.ok());
  assert.equal(
    (await post(a.http, `uploads/${upload.id}/complete`, {})).status(),
    200,
  );
  const started = await post(a.http, "ktp/imports", {
    uploadId: upload.id,
    locale: "en",
    grade: 3,
  });
  assert.equal(started.status(), 202);
  const imported = await started.json();
  await waitJob(a.http, imported.jobId);
  const plan = await (
    await a.http.get(`${origin}/api/ktp/${imported.id}`)
  ).json();
  assert.equal(plan.rows.length, 68);
  assert.equal(plan.grade, 3);
  assert.equal(plan.locale, "en");
  result.englishDocxLessons = plan.rows.length;
  phase = "cross-account isolation";
  for (const path of [
    `ktp/${imported.id}`,
    `uploads/${upload.id}`,
    `jobs/${imported.jobId}`,
  ])
    assert.equal((await b.http.get(`${origin}/api/${path}`)).status(), 404);
  result.foreignObjectsDenied = 3;
  phase = "synthetic export fixture";
  const sample = syntheticDemo("ru"),
    pid = randomUUID(),
    gid = randomUUID(),
    version = randomUUID();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL search_path=${schema},public`);
    await c.query(
      "INSERT INTO plans(id,owner_id,title,grade,locale,status,grades) VALUES($1,$2,'Synthetic release fixture',7,'ru','confirmed',ARRAY[7])",
      [pid, a.owner],
    );
    await c.query(
      "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version,grade,confirmed_at) VALUES($1,$2,1,$3,'synthetic-release',7,now())",
      [randomUUID(), pid, JSON.stringify([sample.row])],
    );
    await c.query(
      "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale,status,demo) VALUES($1,$2,$3,$4,$5,'Synthetic release fixture','ru','needs_review',true)",
      [gid, a.owner, pid, sample.row.id, sample.snapshot],
    );
    await c.query(
      "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,1,$3,$4,'synthetic-no-provider','release-check')",
      [version, gid, sample.document, { status: "needs_review", demo: true }],
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  const data = {
    generationId: gid,
    revision: 1,
    format: "docx",
    audience: "student",
    styles: { font: "Liberation Serif" },
    teacherReviewed: true,
  };
  assert.equal((await post(a.http, "exports", data)).status(), 422);
  assert.equal(
    (
      await post(a.http, `generations/${gid}/approve`, {
        revision: 1,
        teacherReviewed: true,
      })
    ).status(),
    200,
  );
  phase = "PDF and DOCX export";
  for (const format of ["docx", "pdf"]) {
    const key = randomUUID(),
      payload = { ...data, format };
    const response = await post(a.http, "exports", payload, key);
    assert.equal(response.status(), 202);
    const ex = await response.json();
    const replay = await (await post(a.http, "exports", payload, key)).json();
    assert.equal(replay.id, ex.id);
    assert.equal(replay.jobId, ex.jobId);
    await waitJob(a.http, ex.jobId);
    const downloaded = await a.http.get(
      `${origin}/api/exports/${ex.id}/download`,
    );
    assert.equal(downloaded.status(), 200);
    const body = await downloaded.body();
    assert(
      format === "pdf"
        ? body.subarray(0, 5).toString() === "%PDF-"
        : body.subarray(0, 2).toString() === "PK",
    );
    assert.equal(
      (await b.http.get(`${origin}/api/exports/${ex.id}/download`)).status(),
      404,
    );
    result[format + "ExportBytes"] = body.length;
  }
  result.status = "passed";
} catch {
  result.status = "failed";
  result.phase = phase;
  process.exitCode = 1;
} finally {
  for (const actor of actors) {
    const response = await actor.http
      .delete(`${origin}/api/account`, { headers: { Origin: origin } })
      .catch(() => null);
    result.cleanupQueued =
      response?.status() === 200 && result.cleanupQueued !== false;
    await actor.http.dispose();
  }
  if (actors.length) {
    const end = Date.now() + 120000;
    for (;;) {
      const remaining = (
        await pool.query(
          `SELECT count(*)::int AS n FROM ${schema}."user" WHERE id=ANY($1::text[])`,
          [actors.map((actor) => actor.owner)],
        )
      ).rows[0].n;
      if (!remaining) {
        result.syntheticAccountsRemoved = true;
        break;
      }
      if (Date.now() > end) {
        result.syntheticAccountsRemoved = false;
        process.exitCode = 1;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await pool.end();
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
