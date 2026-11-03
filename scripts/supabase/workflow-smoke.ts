import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { databaseConnection } from "../../apps/web/lib/database-connection";
import { syntheticDemo } from "../../packages/domain/demo";
import { settings } from "./migration-config";

// One isolated teacher account. --live-ai explicitly authorizes one real generation.
const values = await settings(process.argv[2] ?? ".env.local");
const origin = values.APP_URL;
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const context = await browser.newContext({ baseURL: origin });
const checks: string[] = [];
let owner: string | undefined;
async function call(
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await context.request.fetch(`/api/${path}`, {
    method,
    headers: {
      Origin: origin,
      "Idempotency-Key": randomUUID(),
      ...(owner ? { "X-ZiyatAI-Account": owner } : {}),
    },
    data,
    timeout: 30000,
  });
  const result = await response.json();
  if (!response.ok())
    throw new Error(
      `${path.split("/")[0]}: HTTP ${response.status()} ${result.code ?? ""}`,
    );
  return result;
}
async function job(id: string) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await call(`jobs/${id}`);
    if (state.status === "succeeded") return state;
    if (["failed", "cancelled"].includes(state.status))
      throw new Error(
        `Job ${state.status}: ${state.error?.code ?? state.error_code ?? "unknown"}`,
      );
    await new Promise((done) => setTimeout(done, 1500));
  }
  throw new Error("Job timed out");
}
try {
  await call("auth/sign-up/email", {
    email: `workflow-smoke-${randomUUID()}@example.test`,
    password: `Smoke-${randomUUID()}!`,
    name: "Synthetic workflow teacher",
    teachingSubject: "informatics",
  });
  owner = (await call("auth/get-session"))?.user?.id;
  if (!owner) throw new Error("Signup session missing");
  checks.push("signup without confirmation");
  const bytes = await readFile("tests/fixtures/ru-table-1.docx");
  const upload = await call("uploads/init", {
    name: "workflow-smoke.docx",
    bytes: bytes.length,
  });
  const written = await context.request.put(upload.url, {
    headers: { "Content-Type": upload.contentType },
    data: bytes,
  });
  if (!written.ok()) throw new Error(`Storage PUT: HTTP ${written.status()}`);
  await call(`uploads/${upload.id}/complete`, {});
  const imported = await call("ktp/imports", {
    uploadId: upload.id,
    locale: "ru",
  });
  await job(imported.jobId);
  const plan = await call(`ktp/${imported.id}`);
  if (plan.rows.length !== 3)
    throw new Error("Import did not preserve fixture rows");
  const confirmed = await call(`ktp/${imported.id}/confirm`, {
    revision: plan.revision,
    rows: plan.rows,
    grade: 7,
    schoolYear: "2026–2027",
  });
  checks.push(
    "signed Storage upload, antivirus scan, import and plan confirmation",
  );
  if (
    process.argv.includes("--live-ai") ||
    process.argv.includes("--fixture-export")
  ) {
    const current = await call(`ktp/${imported.id}`);
    let generation: { id: string; jobId?: string };
    if (process.argv.includes("--live-ai")) {
      generation = await call("generations", {
        planId: imported.id,
        rowId: current.rows[0].id,
        revision: current.revision ?? confirmed.revision,
        locale: "kk",
        count: 1,
        minutes: 15,
        format: "theory",
        constraints: "Қысқа және сыныпқа түсінікті тапсырмалар.",
      });
      await job(generation.jobId!);
    } else {
      const sample = syntheticDemo("kk");
      generation = { id: randomUUID() };
      const pool = new Pool({
        ...databaseConnection({ DATABASE_URL: values.DATABASE_URL, DATABASE_SSL_CA: values.DATABASE_SSL_CA }),
        options: "-c search_path=ziyatai,public",
        max: 1,
      });
      try {
        await pool.query("BEGIN");
        await pool.query(
          "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale,status,demo) VALUES($1,$2,$3,$4,$5,$6,'kk','needs_review',true)",
          [
            generation.id,
            owner,
            imported.id,
            current.rows[0].id,
            sample.snapshot,
            sample.document.title,
          ],
        );
        await pool.query(
          "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,1,$3,$4,'synthetic-no-provider','smoke-1.0')",
          [
            randomUUID(),
            generation.id,
            sample.document,
            {
              status: "needs_review",
              demo: true,
              checks: ["synthetic"],
              limitations: ["Prepared test fixture; AI was not called"],
            },
          ],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      } finally {
        await pool.end();
      }
    }
    const generated = await call(`generations/${generation.id}`);
    if (!generated.document?.tasks?.length)
      throw new Error("Generated document is empty");
    await call(`generations/${generation.id}/approve`, {
      revision: generated.revision,
      teacherReviewed: true,
    });
    checks.push(
      process.argv.includes("--live-ai")
        ? "real AI generation and teacher approval"
        : "synthetic fixture and teacher approval; no AI call",
    );
    await mkdir(".local/qa", { recursive: true });
    for (const format of ["docx", "pdf"]) {
      const exported = await call("exports", {
        generationId: generation.id,
        revision: generated.revision,
        format,
        audience: "student",
        styles: { font: "Liberation Serif" },
        teacherReviewed: true,
      });
      await job(exported.jobId);
      const file = await context.request.get(
        `/api/exports/${exported.id}/download`,
      );
      if (!file.ok()) throw new Error(`Export download: HTTP ${file.status()}`);
      await writeFile(
        `.local/qa/supabase-student.${format}`,
        await file.body(),
      );
      checks.push(`${format} export and authenticated download`);
    }
  }
  console.log(
    JSON.stringify({
      checks,
      realAiRequests: process.argv.includes("--live-ai") ? 1 : 0,
      result: "passed",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      checks,
      result: "failed",
      error: error instanceof Error ? error.message : "Workflow failed",
    }),
  );
  process.exitCode = 1;
} finally {
  if (owner) {
    try {
      await call("account", undefined, "DELETE");
    } catch {
      console.error("Synthetic account cleanup requires a retry");
      process.exitCode = 1;
    }
  }
  await context.close();
  await browser.close();
}
