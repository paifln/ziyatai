import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { db, transaction } from "../../server/infrastructure/database/db";
import { env } from "../../server/config/env";
import { deleteSupabaseIdentity } from "../../server/auth/admin";
import { getObject, putObject, deleteObject } from "../../server/infrastructure/storage/storage";
import { processRun, inspectFile } from "../../server/infrastructure/documents/files";
import { ImportResult } from "../../packages/contracts";
import { planGrades } from "../../packages/domain/grades";
import { validateDocument } from "../../packages/domain/validation";
import { AppError } from "../../packages/domain/errors";
import { renderDocx } from "../../packages/document-renderer";
import { generate } from "./ai";
import { recoverExpiredJobs } from "./recover-jobs";
import { startHeartbeat } from "./heartbeat";
import { finalizeDeletedObjects } from "./delete-resources";
import { exportObjectKey } from "./object-keys";
import { trustedScan } from "../../server/infrastructure/antivirus/scan-policy";
import { isolatedRequest } from "../../server/infrastructure/documents/renderer";
import {
  cleanupAbandonedUploads,
  cleanupQuarantinePage,
} from "../../server/infrastructure/storage/upload-cleanup";
const workerId = randomUUID();
let stopping = false;
let quarantineCursor: string | undefined;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
type Job = {
  id: string;
  owner_id: string;
  kind: string;
  resource_id: string;
  payload: any;
  lease_token: string;
  attempt: number;
  max_attempts: number;
};
async function check(c: any, job: Job) {
  const row = (
    await c.query(
      "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
      [job.id, job.lease_token],
    )
  ).rows[0];
  if (!row || row.cancel_requested) throw new AppError("CANCELLED", 409);
  return row;
}
async function stage(job: Job, value: string) {
  const r = await db().query(
    "UPDATE jobs SET stage=$3,heartbeat=now(),lease_until=now()+$4*interval '1 second',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND cancel_requested=false RETURNING id",
    [job.id, job.lease_token, value, env().JOB_LEASE_SECONDS],
  );
  if (!r.rowCount) throw new AppError("CANCELLED", 409);
}
async function active(
  table: "plans" | "generations" | "exports",
  job: Job,
  c: any = db(),
) {
  const r = await c.query(
    `SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE`,
    [job.resource_id, job.owner_id],
  );
  if (!r.rowCount) throw new AppError("CANCELLED", 409);
  return r.rows[0];
}
async function done(c: any, job: Job, result: unknown) {
  await c.query(
    "UPDATE jobs SET status='succeeded',stage='complete',result=$3,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
    [job.id, job.lease_token, result],
  );
}
async function importPlan(job: Job) {
  if (job.kind === "scan" && env().SCAN_REQUIRED !== "true")
    throw new AppError("SCAN_UNAVAILABLE", 503);
  await stage(job, "extracting");
  await active("plans", job);
  const f = (
    await db().query(
      "SELECT * FROM uploads WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
      [job.payload.uploadId, job.owner_id],
    )
  ).rows[0];
  if (!f || f.status !== "complete") throw new AppError("CANCELLED", 409);
  const ext = f.object_key.split(".").pop();
  const dir = await mkdtemp(join(tmpdir(), "ziyatai-parse-"));
  try {
    const path = join(dir, `source.${ext}`);
    const sourceBytes = await getObject(f.object_key, {
      maximumBytes: Math.min(Number(f.bytes), env().MAX_UPLOAD_MB * 1024 * 1024),
    });
    if (sourceBytes.length !== Number(f.bytes))
      throw new AppError("FILE_INVALID", 422);
    const legacyRescan =
      f.scan_status === "unscanned-development" &&
      env().SCAN_REQUIRED === "true";
    if (
      f.scan_status !== "pending" &&
      createHash("sha256").update(sourceBytes).digest("hex") !== f.checksum
    )
      throw new AppError("FILE_INVALID", 422);
    if (f.scan_status === "pending" || legacyRescan) {
      await stage(job, "scanning");
      let type;
      try {
        type = await inspectFile(sourceBytes, f.original_name);
      } catch (error) {
        if (
          ["FILE_INVALID", "FILE_TYPE", "FILE_SIZE", "FILE_UNSAFE"].includes(
            (error as AppError).code,
          )
        )
          await transaction(async (c) => {
            await check(c, job);
            await c.query(
              "UPDATE uploads SET status='rejected',scan_status='rejected' WHERE id=$1 AND owner_id=$2",
              [f.id, job.owner_id],
            );
          });
        throw error;
      }
      // Signed quarantine URLs stay writable briefly. Publish a separate immutable key,
      // never the key an untrusted client can overwrite after its successful scan.
      const cleanKey = `${job.owner_id}/uploads/${randomUUID()}.${type.ext}`;
      let published = false;
      try {
        await putObject(cleanKey, sourceBytes, type.mime);
        await transaction(async (c) => {
          await check(c, job);
          await active("plans", job, c);
          const updated = await c.query(
            "UPDATE uploads SET object_key=$3,mime=$4,checksum=$5,scan_status=$6 WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND scan_status=$7 AND object_key=$8 RETURNING id",
            [
              f.id,
              job.owner_id,
              cleanKey,
              type.mime,
              createHash("sha256").update(sourceBytes).digest("hex"),
              env().SCAN_REQUIRED === "true"
                ? "clean"
                : "unscanned-development",
              f.scan_status,
              f.object_key,
            ],
          );
          if (!updated.rowCount) throw new AppError("CONFLICT", 409);
        });
        published = true;
      } finally {
        if (!published) await deleteObject(cleanKey).catch(() => {
          console.error(JSON.stringify({ event: "unpublished_source_cleanup_failed" }));
        });
      }
      await deleteObject(f.object_key);
    } else if (!trustedScan(f.scan_status, env()))
      throw new AppError("FILE_UNSAFE", 422);
    if (job.kind === "scan") {
      await transaction(async (c) => {
        await check(c, job);
        await active("plans", job, c);
        await done(c, job, { uploadId: f.id, checked: true });
      });
      return;
    }
    await writeFile(path, sourceBytes);
    const e = env();
    let output: string;
    if (e.RENDERER_URL) {
      output = (
        await isolatedRequest("parse", await readFile(path), ext!, {
          includeHidden: job.payload.includeHidden,
        })
      ).toString("utf8");
    } else if (e.PARSER_CONTAINER_IMAGE) {
      await stage(job, "extracting");
      output = await processRun(
        "docker",
        [
          "run",
          "--rm",
          "--network=none",
          "--memory=1g",
          "--cpus=1",
          "--pids-limit=128",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--user=1000:1000",
          "--read-only",
          "--tmpfs=/tmp:rw,size=256m",
          "--mount",
          `type=bind,source=${dir},target=/data,readonly`,
          "--mount",
          `type=bind,source=${resolve("apps/worker")},target=/scripts,readonly`,
          e.PARSER_CONTAINER_IMAGE,
          "python",
          "/scripts/parser.py",
          `/data/source.${ext}`,
          ...(job.payload.includeHidden ? ["--include-hidden"] : []),
        ],
        300000,
      );
    } else
      output = await processRun(
        e.PYTHON_PATH,
        [
          "apps/worker/parser.py",
          path,
          ...(job.payload.includeHidden ? ["--include-hidden"] : []),
        ],
        300000,
      );
    await stage(job, "normalizing");
    const result = ImportResult.parse(JSON.parse(output));
    const detectedGrades = planGrades(result.rows);
    const importedGrade =
      job.payload.grade ??
      (detectedGrades.length === 1 ? detectedGrades[0] : null);
    await transaction(async (c) => {
      await check(c, job);
      await active("plans", job, c);
      await c.query(
        "INSERT INTO plan_versions(id,plan_id,revision,rows,warnings,unrecognized,parser_version,grade) VALUES($1,$2,1,$3,$4,$5,$6,$7) ON CONFLICT(plan_id,revision) DO NOTHING",
        [
          randomUUID(),
          job.resource_id,
          JSON.stringify(result.rows),
          JSON.stringify(result.warnings),
          JSON.stringify(result.unrecognized),
          result.parserVersion,
          importedGrade,
        ],
      );
      await c.query(
        "UPDATE plans SET status='review',grade=$2,grades=$3 WHERE id=$1",
        [
          job.resource_id,
          importedGrade,
          planGrades(result.rows, importedGrade),
        ],
      );
      await done(c, job, {
        planId: job.resource_id,
        rows: result.rows.length,
        requiresReview: true,
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function generateTasks(job: Job) {
  await stage(job, "generating");
  const g = await active("generations", job);
  let old: any;
  let task: any;
  if (job.kind === "regenerate") {
    if (g.revision !== job.payload.revision)
      throw new AppError("CONFLICT", 409);
    old = (
      await db().query(
        "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
        [g.id, g.revision],
      )
    ).rows[0];
    task = old.document.tasks.find((t: any) => t.id === job.payload.taskId);
    if (!task) throw new AppError("NOT_FOUND", 404);
  }
  const result = await generate(
    g.source_snapshot,
    task ? { task } : undefined,
    async () => {
      const budget = await db().query(
        "UPDATE jobs SET provider_calls=provider_calls+1 WHERE id=$1 AND lease_token=$2 AND provider_calls<3 AND cancel_requested=false RETURNING id",
        [job.id, job.lease_token],
      );
      if (!budget.rowCount) throw new AppError("AI_INVALID", 422);
    },
  );
  await stage(job, "validating");
  const document = result.doc ?? {
    ...old.document,
    tasks: old.document.tasks.map((t: any) =>
      t.id === task.id ? result.task : t,
    ),
  };
  const report = validateDocument(document, g.source_snapshot);
  if (report.issues.length) throw new AppError("AI_INVALID", 422);
  await transaction(async (c) => {
    await check(c, job);
    const current = await active("generations", job, c);
    if (job.kind === "regenerate" && current.revision !== job.payload.revision)
      throw new AppError("CONFLICT", 409);
    const revision = job.kind === "regenerate" ? g.revision + 1 : 1;
    await c.query(
      "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version,usage,provider_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(generation_id,revision) DO NOTHING",
      [
        randomUUID(),
        g.id,
        revision,
        document,
        { ...report, doc: undefined },
        result.model,
        result.promptVersion,
        result.usage,
        result.requestId,
      ],
    );
    await c.query(
      "UPDATE generations SET status='needs_review',revision=$2 WHERE id=$1",
      [g.id, revision],
    );
    await c.query(
      "UPDATE usage_ledger SET state='charged',tokens=tokens+$2 WHERE job_id=$1",
      [
        job.id,
        (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
      ],
    );
    await done(c, job, { generationId: g.id, revision });
  });
}
async function exportDocument(job: Job) {
  await stage(job, "rendering");
  const ex = await active("exports", job);
  const g = (
    await db().query(
      "SELECT * FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
      [ex.generation_id, job.owner_id],
    )
  ).rows[0];
  if (!g) throw new AppError("CANCELLED", 409);
  const v = (
    await db().query(
      "SELECT * FROM generation_versions WHERE id=$1 AND generation_id=$2",
      [ex.generation_version_id, g.id],
    )
  ).rows[0];
  if (!v) throw new AppError("NOT_FOUND", 404);
  if (!ex.teacher_reviewed || !v.reviewed_at || v.reviewed_by !== job.owner_id)
    throw new AppError("REVIEW_REQUIRED", 422);
  const dir = await mkdtemp(join(tmpdir(), "ziyatai-render-"));
  let key: string | undefined;
  let published = false;
  try {
    const doc = await renderDocx(
      v.document,
      g.source_snapshot,
      ex.styles,
      ex.audience,
      ex.teacher_reviewed,
    );
    const path = join(dir, "material.docx");
    await writeFile(path, doc);
    if (env().RENDERER_URL) await isolatedRequest("inspect", doc, "docx");
    else
      await processRun(env().PYTHON_PATH, [
        "apps/worker/renderer-check.py",
        path,
      ]);
    let bytes: Buffer = doc;
    if (ex.format === "pdf") {
      const e = env();
      const args = [
        "-env:UserInstallation=file:///tmp/lo-profile",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        "/data",
        "/data/material.docx",
      ];
      if (e.RENDERER_URL) {
        await writeFile(
          join(dir, "material.pdf"),
          await isolatedRequest("render", doc, "docx", {
            font: ex.styles.font,
          }),
        );
      } else if (e.RENDER_CONTAINER_IMAGE) {
        const fontMount = e.FONT_DIRECTORY
          ? [
              "--mount",
              `type=bind,source=${e.FONT_DIRECTORY},target=/usr/local/share/fonts/licensed,readonly`,
            ]
          : [];
        await processRun(
          "docker",
          [
            "run",
            "--rm",
            "--network=none",
            "--memory=1g",
            "--cpus=1",
            "--pids-limit=128",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--user=1000:1000",
            "--read-only",
            "--tmpfs=/tmp:rw,size=256m",
            "--mount",
            `type=bind,source=${dir},target=/data`,
            ...fontMount,
            e.RENDER_CONTAINER_IMAGE,
            "/scripts/render.sh",
            ex.styles.font,
            ...args,
          ],
          120000,
        );
      } else {
        const match = await processRun("fc-match", [
          "-f",
          "%{family}",
          ex.styles.font,
        ]);
        if (!match.includes(ex.styles.font))
          throw new AppError("FONT_UNAVAILABLE", 503);
        await processRun(
          e.SOFFICE_PATH,
          [
            `-env:UserInstallation=file://${dir.replace(/\\/g, "/")}/lo-profile`,
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            dir,
            path,
          ],
          120000,
        );
      }
      const pdf = join(dir, "material.pdf");
      try {
        bytes = await readFile(pdf);
      } catch {
        throw new AppError("RENDER_UNAVAILABLE", 503);
      }
      if (!e.RENDERER_URL)
        await processRun(e.PYTHON_PATH, ["apps/worker/renderer-check.py", pdf]);
    }
    await stage(job, "publishing");
    key = exportObjectKey(job.owner_id, ex.id, job.lease_token, ex.format);
    await putObject(
      key,
      bytes,
      ex.format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await transaction(async (c) => {
      await check(c, job);
      await active("exports", job, c);
      const parent = await c.query(
        "SELECT 1 FROM generations WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [ex.generation_id],
      );
      if (!parent.rowCount) throw new AppError("CANCELLED", 409);
      await c.query(
        "UPDATE exports SET status='succeeded',object_key=$2,checksum=$3,renderer_version=$4 WHERE id=$1",
        [
          ex.id,
          key,
          createHash("sha256").update(bytes).digest("hex"),
          "docx-9.11/lo-pinned",
        ],
      );
      await done(c, job, { exportId: ex.id });
    });
    published = true;
  } finally {
    if (key && !published) await deleteObject(key).catch(() => {
      console.error(JSON.stringify({ event: "unpublished_export_cleanup_failed" }));
    });
    await rm(dir, { recursive: true, force: true });
  }
}
async function deleteResources(job: Job) {
  await stage(job, "deleting");
  const keys = await db().query(
    "SELECT object_key FROM uploads WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) UNION SELECT object_key FROM exports WHERE owner_id=$1 AND ($2::boolean OR deleted_at IS NOT NULL) AND object_key IS NOT NULL",
    [job.owner_id, job.payload.scope === "account"],
  );
  for (const { object_key } of keys.rows) await deleteObject(object_key);
  if (job.payload.scope === "account") await deleteSupabaseIdentity(job.owner_id);
  await transaction(async (c) => {
    await check(c, job);
    await finalizeDeletedObjects(c, job.owner_id, keys.rows.map((row) => row.object_key), job.payload.scope === "account");
    await done(c, job, { deletedObjects: keys.rowCount });
    if (job.payload.scope === "account") {
      await c.query("DELETE FROM usage_ledger WHERE owner_id=$1", [
        job.owner_id,
      ]);
      await c.query("DELETE FROM jobs WHERE owner_id=$1", [job.owner_id]);
      await c.query("DELETE FROM audit WHERE owner_id=$1", [job.owner_id]);
      await c.query('DELETE FROM "user" WHERE id=$1', [job.owner_id]);
    }
  });
}
async function fail(job: Job, error: unknown) {
  const code = error instanceof AppError ? error.code : "INTERNAL";
  const retry =
    [
      "AI_RATE_LIMIT",
      "AI_TEMPORARY",
      "INTERNAL",
      "RENDER_UNAVAILABLE",
    ].includes(code) && job.attempt < job.max_attempts;
  await transaction(async (c) => {
    const own = await c.query(
      "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
      [job.id, job.lease_token],
    );
    if (!own.rowCount) return;
    const cancelled = own.rows[0].cancel_requested || code === "CANCELLED";
    const metering = (error as any)?.providerUsage;
    const billedTokens =
      (metering?.input_tokens ?? 0) + (metering?.output_tokens ?? 0);
    if (billedTokens)
      await c.query(
        "UPDATE usage_ledger SET tokens=tokens+$2 WHERE job_id=$1",
        [job.id, billedTokens],
      );
    const status = cancelled ? "cancelled" : retry ? "queued" : "failed";
    await c.query(
      "UPDATE jobs SET status=$3,stage=$3,error_code=$4,available_at=now()+$5*interval '1 second',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [
        job.id,
        job.lease_token,
        status,
        code,
        Math.min(120, 2 ** job.attempt * 3) + Math.random() * 3,
      ],
    );
    if (!retry || cancelled) {
      await c.query(
        "UPDATE usage_ledger SET state=$2 WHERE job_id=$1 AND state='reserved'",
        [
          job.id,
          billedTokens > 0 ||
          code === "AI_UNCERTAIN" ||
          code === "AI_INVALID" ||
          code === "AI_INCOMPLETE"
            ? "uncertain"
            : "released",
        ],
      );
      if (job.kind === "import")
        await c.query(
          "UPDATE plans SET status=$2 WHERE id=$1 AND deleted_at IS NULL",
          [job.resource_id, cancelled ? "cancelled" : "failed"],
        );
      if (job.kind === "generate")
        await c.query(
          "UPDATE generations SET status=$2 WHERE id=$1 AND deleted_at IS NULL",
          [job.resource_id, cancelled ? "cancelled" : "failed"],
        );
      if (job.kind === "export")
        await c.query(
          "UPDATE exports SET status=$2 WHERE id=$1 AND deleted_at IS NULL",
          [job.resource_id, cancelled ? "cancelled" : "failed"],
        );
    }
  });
  console.log(
    JSON.stringify({
      jobId: job.id,
      outcome: retry ? "retry" : "failed",
      code,
    }),
  );
}
async function janitor() {
  await db().query(
    "DELETE FROM editor_drafts WHERE id IN (SELECT id FROM editor_drafts WHERE expires_at<=now() ORDER BY expires_at LIMIT 500)",
  );
  const recovered = await transaction(recoverExpiredJobs);
  if (recovered.queued || recovered.failed || recovered.cancelled)
    console.log(JSON.stringify({ event: "lease_recovery", ...recovered }));
  await db().query(
    "DELETE FROM api_limits WHERE window_start<now()-interval '1 day'",
  );
  const cleanup = await cleanupAbandonedUploads();
  try {
    const sweep = await cleanupQuarantinePage(quarantineCursor);
    quarantineCursor = sweep.nextCursor;
    if (sweep.failed)
      console.error(
        JSON.stringify({
          code: "QUARANTINE_CLEANUP_RETRY",
          count: sweep.failed,
        }),
      );
  } catch {
    console.error(JSON.stringify({ code: "QUARANTINE_CLEANUP_RETRY" }));
  }
  if (cleanup.failed)
    console.error(
      JSON.stringify({ code: "UPLOAD_CLEANUP_RETRY", count: cleanup.failed }),
    );
  for (const name of await readdir(tmpdir()))
    if (name.startsWith("ziyatai-")) {
      const path = join(tmpdir(), name);
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 86400000)
        await rm(path, { recursive: true, force: true });
    }
}
let lastJanitor = 0;
while (!stopping) {
  try {
    await db().query(
      "INSERT INTO worker_health(id,heartbeat) VALUES($1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat=now()",
      [workerId],
    );
    if (Date.now() - lastJanitor > 30000) {
      await janitor();
      lastJanitor = Date.now();
    }
    const job = await transaction(async (c) => {
      const claim = await c.query(
        "SELECT id FROM jobs WHERE status='queued' AND kind IN ('import','scan','generate','regenerate','export','delete') AND available_at<=now() AND cancel_requested=false ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!claim.rowCount) return null;
      const token = randomUUID();
      return (
        await c.query(
          "UPDATE jobs SET status='running',attempt=attempt+1,lease_token=$2,lease_until=now()+$3*interval '1 second',heartbeat=now(),updated_at=now() WHERE id=$1 RETURNING *",
          [claim.rows[0].id, token, env().JOB_LEASE_SECONDS],
        )
      ).rows[0] as Job;
    });
    if (!job) {
      await new Promise((r) => setTimeout(r, env().WORKER_POLL_MS));
      continue;
    }
    const started = Date.now();
    const stopHeartbeat = startHeartbeat(() => db().query(
      "WITH renewed AS (UPDATE jobs SET heartbeat=now(),lease_until=now()+$3*interval '1 second' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id) UPDATE worker_health SET heartbeat=now() WHERE id=$4",
      [job.id, job.lease_token, env().JOB_LEASE_SECONDS, workerId],
    ));
    try {
      if (job.kind === "import" || job.kind === "scan") await importPlan(job);
      else if (["generate", "regenerate"].includes(job.kind))
        await generateTasks(job);
      else if (job.kind === "export") await exportDocument(job);
      else if (job.kind === "delete") await deleteResources(job);
      else throw new AppError("INTERNAL", 503);
      console.log(
        JSON.stringify({
          jobId: job.id,
          outcome: "succeeded",
          durationMs: Date.now() - started,
        }),
      );
    } catch (e) {
      await fail(job, e);
    } finally {
      stopHeartbeat();
    }
  } catch {
    console.error(
      JSON.stringify({ outcome: "worker_error", code: "INTERNAL" }),
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await db().query("DELETE FROM worker_health WHERE id=$1", [workerId]);
await db().end();
