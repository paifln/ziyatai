import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { db, transaction } from "../../../server/infrastructure/database/db";
import { env } from "../../../server/config/env";
import {
  getObject,
  putObject,
  deleteObject,
} from "../../../server/infrastructure/storage/storage";
import {
  processRun,
  inspectFile,
} from "../../../server/infrastructure/documents/files";
import { ImportResult } from "../../../packages/contracts";
import { planGrades } from "../../../packages/domain/grades";
import { AppError } from "../../../packages/domain/errors";
import { trustedScan } from "../../../server/infrastructure/antivirus/scan-policy";
import { isolatedRequest } from "../../../server/infrastructure/documents/renderer";
import { type Job, check, stage, active, done } from "./context";
export async function importPlan(job: Job) {
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
      maximumBytes: Math.min(
        Number(f.bytes),
        env().MAX_UPLOAD_MB * 1024 * 1024,
      ),
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
        if (!published)
          await deleteObject(cleanKey).catch(() => {
            console.error(
              JSON.stringify({ event: "unpublished_source_cleanup_failed" }),
            );
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
