import { PlanStatus, SourceLocale } from "../../../packages/contracts";
import { normalizePlanRows } from "../../../packages/domain/plan-review";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../request-body";
import { withFileBufferCapacity } from "../../infrastructure/documents/file-buffer-capacity";
import { db, transaction } from "../../infrastructure/database/db";
import { env } from "../../config/env";
import { getObject } from "../../infrastructure/storage/storage";
import { isolatedRequest } from "../../infrastructure/documents/renderer";
import { enqueue } from "../../infrastructure/queue/queue";
import { AppError } from "../../../packages/domain/errors";
import { Row } from "../../../packages/contracts";
import { trustedScan } from "../../infrastructure/antivirus/scan-policy";
import {
  sourceStatus,
  startSourceCheck,
} from "../../application/source-checks";
import { planCollection } from "../../application/plan-collection";
import {
  type ApiContext,
  uid,
  owned,
  json,
  currentPlan,
  savePlan,
} from "../context";
export async function handlePlans(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, path, resource, id, action, method, url, owner, limit, offset } =
    context;
  if (resource === "ktp" && id === "collection" && method === "GET")
    return json(await planCollection(owner, url.searchParams));
  if (resource === "ktp" && id === "imports" && method === "POST") {
    const b = z
      .object({
        uploadId: uid,
        locale: SourceLocale,
        includeHidden: z.boolean().default(false),
        grade: z.number().int().min(1).max(11).nullable().optional(),
      })
      .parse(await body(req));
    const f = await owned("uploads", b.uploadId, owner);
    if (f.status !== "complete" || f.scan_status === "rejected")
      throw new AppError("CONFLICT", 409);
    const result = await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [b.uploadId]);
      const locked = await c.query(
        "SELECT 1 FROM uploads WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [b.uploadId, owner],
      );
      if (!locked.rowCount) throw new AppError("NOT_FOUND", 404);
      const existing = await c.query(
        "SELECT j.id,j.resource_id,j.kind,j.payload,p.locale FROM jobs j LEFT JOIN plans p ON p.id=j.resource_id WHERE j.owner_id=$1 AND j.idempotency_key=$2",
        [owner, `import:${b.uploadId}`],
      );
      if (existing.rowCount) {
        const original = existing.rows[0];
        if (
          original.kind !== "import" ||
          original.payload.uploadId !== b.uploadId ||
          Boolean(original.payload.includeHidden) !== b.includeHidden ||
          (original.payload.grade ?? null) !== (b.grade ?? null) ||
          original.locale !== b.locale
        )
          throw new AppError("CONFLICT", 409);
        return {
          id: original.resource_id,
          jobId: original.id,
        };
      }
      const planId = randomUUID();
      await c.query(
        "INSERT INTO plans(id,owner_id,file_id,title,locale,grade) VALUES($1,$2,$3,$4,$5,$6)",
        [planId, owner, b.uploadId, f.original_name, b.locale, b.grade ?? null],
      );
      const jobId = await enqueue(
        c,
        owner,
        "import",
        planId,
        {
          uploadId: b.uploadId,
          includeHidden: b.includeHidden,
          grade: b.grade ?? null,
        },
        `import:${b.uploadId}`,
      );
      return { id: planId, jobId };
    });
    return json(result, 202);
  }
  if (resource === "ktp" && !id && method === "GET") {
    const status = PlanStatus.optional().parse(
      url.searchParams.get("status") ?? undefined,
    );
    return json(
      (
        await db().query(
          "SELECT id,title,grade,school_year,locale,status,revision,created_at FROM plans WHERE owner_id=$1 AND deleted_at IS NULL AND title ILIKE $2 AND ($5::text IS NULL OR status=$5) ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4",
          [
            owner,
            `%${(url.searchParams.get("q") ?? "").slice(0, 200)}%`,
            limit,
            offset,
            status ?? null,
          ],
        )
      ).rows,
    );
  }
  if (resource === "ktp" && id && action === "source") {
    if (path.length !== 3) throw new AppError("NOT_FOUND", 404);
    uid.parse(id);
    if (method === "GET" || method === "HEAD")
      return json(await sourceStatus(owner, id));
    if (method === "POST") {
      const key = uid.parse(req.headers.get("idempotency-key"));
      return json(await startSourceCheck(owner, id, key), 202);
    }
    return Response.json(
      { code: "METHOD_NOT_ALLOWED" },
      {
        status: 405,
        headers: { Allow: "GET, HEAD, POST", "Cache-Control": "no-store" },
      },
    );
  }
  if (resource === "ktp" && id && action === "preview" && method === "GET") {
    const plan = await owned("plans", id, owner);
    const file = await owned("uploads", plan.file_id, owner);
    if (!trustedScan(file.scan_status, env()))
      throw new AppError("CONFLICT", 409);
    if (file.mime !== "application/pdf") throw new AppError("FILE_TYPE", 415);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(150)
      .parse(url.searchParams.get("page") ?? "1");
    return await withFileBufferCapacity(async () => {
      const preview = await isolatedRequest(
        "preview",
        await getObject(file.object_key, {
          maximumBytes: Math.min(
            Number(file.bytes),
            env().MAX_UPLOAD_MB * 1024 * 1024,
          ),
          signal: req.signal,
        }),
        "pdf",
        { page, signal: req.signal },
      );
      return new Response(
        new Uint8Array(preview.buffer, preview.byteOffset, preview.byteLength),
        {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "private, no-store",
          },
        },
      );
    });
  }
  if (resource === "ktp" && id && method === "GET")
    return json(await currentPlan(id, owner));
  if (
    resource === "ktp" &&
    id &&
    ["PATCH", "POST"].includes(method) &&
    ["rows", "confirm"].includes(action)
  ) {
    const b = z
      .object({
        revision: z.number().int().positive(),
        rows: z.array(Row).max(2000),
        grade: z.number().int().min(1).max(11).nullable(),
        schoolYear: z.string().max(20),
      })
      .parse(await body(req));
    if (new Set(b.rows.map((r) => r.id)).size !== b.rows.length)
      throw new AppError("FILE_INVALID", 422);
    const normalized = normalizePlanRows(b.rows);
    return json(
      await savePlan(
        owner,
        id,
        b.revision,
        normalized,
        b.grade,
        b.schoolYear,
        action === "confirm",
      ),
    );
  }
}
