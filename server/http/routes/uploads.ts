import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body, boundedRequest } from "../request-body";
import { withFileBufferCapacity } from "../../infrastructure/documents/file-buffer-capacity";
import { db, transaction } from "../../infrastructure/database/db";
import { env } from "../../config/env";
import {
  putObject,
  deleteObject,
  signedUpload,
  objectMetadata,
} from "../../infrastructure/storage/storage";
import { inspectFile } from "../../infrastructure/documents/files";
import { AppError } from "../../../packages/domain/errors";
import { objectDownload } from "../../infrastructure/storage/object-download";
import { trustedScan } from "../../infrastructure/antivirus/scan-policy";
import { uploadFormat } from "../../../packages/domain/uploads";
import { assertUploadStorageQuota } from "../../infrastructure/storage/storage-quota";
import { type ApiContext, owned, json } from "../context";
export async function handleUploads(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, id, action, method, owner } = context;
  if (resource === "uploads" && id === "init" && method === "POST") {
    const b = z
      .object({
        name: z.string().min(1).max(200),
        bytes: z
          .number()
          .int()
          .positive()
          .max(env().MAX_UPLOAD_MB * 1024 * 1024),
      })
      .parse(await body(req));
    const format = uploadFormat(b.name);
    if (!format) throw new AppError("FILE_TYPE", 415);
    const { ext: extension, mime } = format;
    const uploadId = randomUUID(),
      key = `quarantine/${owner}/${uploadId}.${extension}`;
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        owner + ":storage",
      ]);
      const alive = await c.query(
        'SELECT 1 FROM "user" u LEFT JOIN profiles p ON p.owner_id=u.id WHERE u.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF u',
        [owner],
      );
      if (!alive.rowCount) throw new AppError("UNAUTHORIZED", 401);
      await assertUploadStorageQuota(c, owner, b.bytes);
      await c.query(
        "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status,status) VALUES($1,$2,$3,$4,$5,$6,'','pending','pending')",
        [uploadId, owner, key, b.name, mime, b.bytes],
      );
    });
    try {
      return json(
        {
          id: uploadId,
          url: await signedUpload(key, b.bytes, mime),
          contentType: mime,
          expiresIn: 300,
        },
        201,
      );
    } catch (error) {
      await db().query("DELETE FROM uploads WHERE id=$1 AND status='pending'", [
        uploadId,
      ]);
      throw error;
    }
  }
  if (
    resource === "uploads" &&
    id &&
    action === "complete" &&
    method === "POST"
  ) {
    const file = await owned("uploads", id, owner);
    if (file.status === "complete") return json({ id });
    if (
      file.status !== "pending" ||
      Date.now() - new Date(file.created_at).getTime() > 15 * 60 * 1000
    )
      throw new AppError("CONFLICT", 409);
    const meta = await objectMetadata(file.object_key, req.signal);
    if (
      meta.ContentLength !== Number(file.bytes) ||
      meta.ContentType !== file.mime
    )
      throw new AppError("FILE_INVALID", 422);
    const result = await db().query(
      "UPDATE uploads SET status='complete' WHERE id=$1 AND owner_id=$2 AND status='pending' AND deleted_at IS NULL RETURNING id",
      [id, owner],
    );
    if (!result.rowCount) throw new AppError("CONFLICT", 409);
    return json({ id });
  }
  if (resource === "uploads" && method === "POST" && !id) {
    if (env().DIRECT_UPLOADS === "true")
      throw new AppError("FILE_INVALID", 400);
    return await withFileBufferCapacity(async () => {
      const bounded = await boundedRequest(
        req,
        (env().MAX_UPLOAD_MB + 1) * 1024 * 1024,
      );
      const form = await bounded.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("FILE_INVALID", 400);
      if (!file.size || file.size > env().MAX_UPLOAD_MB * 1024 * 1024)
        throw new AppError("FILE_SIZE", 413);
      await assertUploadStorageQuota(db(), owner, file.size);
      const bytes = Buffer.from(await file.arrayBuffer());
      const type = await inspectFile(bytes, file.name);
      const uploadId = randomUUID();
      const key = `${owner}/uploads/${uploadId}.${type.ext}`;
      try {
        await putObject(key, bytes, type.mime, req.signal);
        await transaction(async (c) => {
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            owner + ":storage",
          ]);
          await assertUploadStorageQuota(c, owner, file.size);
          const alive = await c.query(
            'SELECT 1 FROM "user" u LEFT JOIN profiles p ON p.owner_id=u.id WHERE u.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF u',
            [owner],
          );
          if (!alive.rowCount) throw new AppError("UNAUTHORIZED", 401);
          await c.query(
            "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              uploadId,
              owner,
              key,
              file.name.slice(0, 200),
              type.mime,
              bytes.length,
              createHash("sha256").update(bytes).digest("hex"),
              env().SCAN_REQUIRED === "true"
                ? "clean"
                : "unscanned-development",
            ],
          );
        });
      } catch (e) {
        // A failed acknowledgement does not prove that S3 discarded the PUT.
        await deleteObject(key).catch(() => {
          console.error(
            JSON.stringify({ event: "unpublished_upload_cleanup_failed" }),
          );
        });
        throw e;
      }
      return json({ id: uploadId, name: file.name }, 201);
    });
  }
  if (resource === "uploads" && id && ["GET", "HEAD"].includes(method)) {
    const f = await owned("uploads", id, owner);
    if (!trustedScan(f.scan_status, env()) || f.status !== "complete")
      throw new AppError("CONFLICT", 409);
    return await objectDownload(req, f.object_key, {
      "Content-Type": f.mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    });
  }
}
