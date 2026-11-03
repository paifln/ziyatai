import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, transaction } from "../../../server/infrastructure/database/db";
import { env } from "../../../server/config/env";
import {
  putObject,
  deleteObject,
} from "../../../server/infrastructure/storage/storage";
import { processRun } from "../../../server/infrastructure/documents/files";
import { AppError } from "../../../packages/domain/errors";
import { renderDocx } from "../../../packages/document-renderer";
import { exportObjectKey } from "../object-keys";
import { isolatedRequest } from "../../../server/infrastructure/documents/renderer";
import { type Job, check, stage, active, done } from "./context";
export async function exportDocument(job: Job) {
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
    if (key && !published)
      await deleteObject(key).catch(() => {
        console.error(
          JSON.stringify({ event: "unpublished_export_cleanup_failed" }),
        );
      });
    await rm(dir, { recursive: true, force: true });
  }
}
