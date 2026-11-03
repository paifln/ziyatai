import { randomUUID } from "node:crypto";
import { rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, transaction } from "../../server/infrastructure/database/db";
import { env } from "../../server/config/env";
import { AppError } from "../../packages/domain/errors";
import { recoverExpiredJobs } from "./recover-jobs";
import { startHeartbeat } from "./heartbeat";
import {
  cleanupAbandonedUploads,
  cleanupQuarantinePage,
} from "../../server/infrastructure/storage/upload-cleanup";
import { importPlan } from "./jobs/import-plan";
import { generateTasks } from "./jobs/generate-tasks";
import { exportDocument } from "./jobs/export-document";
import { deleteResources } from "./jobs/delete-resources";
import { fail } from "./jobs/failure";
import { type Job } from "./jobs/context";

const workerId = randomUUID();

let stopping = false;

let quarantineCursor: string | undefined;

process.on("SIGTERM", () => {
  stopping = true;
});

process.on("SIGINT", () => {
  stopping = true;
});

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
    const stopHeartbeat = startHeartbeat(() =>
      db().query(
        "WITH renewed AS (UPDATE jobs SET heartbeat=now(),lease_until=now()+$3*interval '1 second' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id) UPDATE worker_health SET heartbeat=now() WHERE id=$4",
        [job.id, job.lease_token, env().JOB_LEASE_SECONDS, workerId],
      ),
    );
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
