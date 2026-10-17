import { syntheticDemo } from "../../../packages/domain/demo";
import { rowGrade } from "../../../packages/domain/grades";
import { GenerationDoc } from "../../../packages/contracts";
import { normalizeDate } from "../../../packages/domain/dates";
import {
  hasGoalText,
  hasRequiredGoals,
  maySkipGoals,
} from "../../../packages/domain/goals";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { auth } from "./auth";
import { readJsonBody as body, boundedRequest } from "./request-body";
import { withUploadCapacity } from "./upload-capacity";
import { db, transaction } from "./db";
import { env } from "./env";
import { trustedGatewayRequest } from "./netlify-gateway";
import {
  putObject,
  getObject,
  deleteObject,
  storageReady,
  signedUpload,
  objectMetadata,
} from "./storage";
import { inspectFile } from "./files";
import { isolatedRequest } from "./renderer";
import { enqueue, reserveQuota } from "./queue";
import { AppError, messages } from "../../../packages/domain/errors";
import {
  GenerateInput,
  Row,
  Styles,
  Task,
  type KtpRow,
} from "../../../packages/contracts";
import { validateDocument } from "../../../packages/domain/validation";
import { editorDrafts } from "./editor-drafts";
import { admitRead, ReadBudgetError } from "./read-budgets";
import { objectDownload } from "./object-download";
const uid = z.string().uuid();
async function owned(
  table: "plans" | "generations" | "exports" | "uploads" | "jobs",
  id: string,
  owner: string,
) {
  uid.parse(id);
  const deleted = table === "jobs" ? "" : " AND deleted_at IS NULL";
  const result = await db().query(
    `SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2${deleted}`,
    [id, owner],
  );
  if (!result.rowCount) throw new AppError("NOT_FOUND", 404);
  return result.rows[0];
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function audit(
  owner: string,
  action: string,
  id: string,
  requestId: string,
) {
  await db().query(
    "INSERT INTO audit(id,owner_id,action,resource_id,request_id) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), owner, action, id, requestId],
  );
}
async function currentPlan(id: string, owner: string) {
  const plan = await owned("plans", id, owner);
  const v = await db().query(
    "SELECT * FROM plan_versions WHERE plan_id=$1 AND revision=$2",
    [id, plan.revision],
  );
  return { ...plan, ...v.rows[0], id: plan.id };
}
async function currentGeneration(id: string, owner: string, revision?: number) {
  const g = await owned("generations", id, owner);
  const v = await db().query(
    "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
    [id, revision ?? g.revision],
  );
  return { ...g, ...v.rows[0], id: g.id, versionId: v.rows[0]?.id };
}
async function savePlan(
  owner: string,
  id: string,
  expected: number,
  rows: KtpRow[],
  grade: number | null,
  year: string,
  confirm = false,
) {
  return transaction(async (c) => {
    const p = await c.query(
      "SELECT * FROM plans WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
      [id, owner],
    );
    if (!p.rowCount) throw new AppError("NOT_FOUND", 404);
    if (p.rows[0].revision !== expected) throw new AppError("CONFLICT", 409);
    const old = (
      await c.query(
        "SELECT * FROM plan_versions WHERE plan_id=$1 AND revision=$2",
        [id, expected],
      )
    ).rows[0];
    if (
      confirm &&
      ((!grade && rows.some((r) => !rowGrade(r))) ||
        !rows.length ||
        rows.some((r) => !r.topic.trim() || !hasRequiredGoals(r)))
    )
      throw new AppError("UNCONFIRMED", 422);
    const revision = expected + 1;
    await c.query(
      "INSERT INTO plan_versions(id,plan_id,revision,rows,warnings,unrecognized,parser_version,grade,school_year,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        randomUUID(),
        id,
        revision,
        JSON.stringify(rows),
        JSON.stringify(old.warnings),
        JSON.stringify(old.unrecognized),
        old.parser_version,
        grade,
        year,
        confirm ? new Date() : null,
      ],
    );
    await c.query(
      "UPDATE plans SET revision=$2,status=$3,grade=$4,school_year=$5 WHERE id=$1",
      [id, revision, confirm ? "confirmed" : "review", grade, year],
    );
    return { revision };
  });
}
export async function handle(req: Request, path: string[]) {
  const requestId = randomUUID();
  try {
    const method = req.method,
      url = new URL(req.url);
    const [resource, id, action, child] = path;
    if (resource === "health") {
      if (action === "ready" || id === "ready") {
        await db().query("SELECT 1");
        await storageReady();
        const h = await db().query(
          "SELECT 1 FROM worker_health WHERE heartbeat>now()-interval '60 seconds'",
        );
        if (!h.rowCount) return json({ status: "degraded" }, 503);
      }
      return json({ status: "ok" });
    }
    req = trustedGatewayRequest(req);
    if (resource === "public-config" && path.length === 1 && method === "GET") {
      const e = env();
      return json({
        emailVerificationRequired: e.EMAIL_VERIFICATION_REQUIRED === "true",
        passwordResetAvailable: !!e.SMTP_HOST && !!e.SMTP_FROM,
        localMailbox:
          e.APP_ENV === "local" &&
          e.SMTP_PORT === 1025 &&
          !e.SMTP_USER &&
          ["localhost", "127.0.0.1", "host.docker.internal", "mail"].includes(
            e.SMTP_HOST,
          ),
      });
    }
    const session = await auth().api.getSession({ headers: req.headers });
    if (
      !session ||
      (env().EMAIL_VERIFICATION_REQUIRED === "true" &&
        !session.user.emailVerified)
    )
      throw new AppError("UNAUTHORIZED", 401);
    const owner = session.user.id;
    const p = await db().query(
      "SELECT deleted_at FROM profiles WHERE owner_id=$1",
      [owner],
    );
    if (p.rows[0]?.deleted_at) throw new AppError("UNAUTHORIZED", 401);
    if (["GET", "HEAD"].includes(method)) await admitRead(owner, path);
    if (!["GET", "HEAD"].includes(method)) {
      if (req.headers.get("origin") !== env().APP_URL)
        throw new AppError("CSRF", 403);
      const limit = await db().query(
        "INSERT INTO api_limits(key,window_start,count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(key,window_start) DO UPDATE SET count=api_limits.count+1 RETURNING count",
        [owner],
      );
      if (limit.rows[0].count > 60) throw new AppError("LIMIT", 429);
    }
    const limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(url.searchParams.get("limit"))) || 30),
    );
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(url.searchParams.get("offset") ?? "0");
    if (resource === "drafts") return await editorDrafts(req, path, owner);
    if (resource === "account" && method === "DELETE") {
      await transaction(async (c) => {
        await c.query(
          "INSERT INTO profiles(owner_id,deleted_at) VALUES($1,now()) ON CONFLICT(owner_id) DO UPDATE SET deleted_at=now()",
          [owner],
        );
        await c.query('DELETE FROM session WHERE "userId"=$1', [owner]);
        await c.query("DELETE FROM editor_drafts WHERE owner_id=$1", [owner]);
        for (const table of ["uploads", "plans", "generations", "exports"])
          await c.query(
            `UPDATE ${table} SET deleted_at=now() WHERE owner_id=$1`,
            [owner],
          );
        await c.query(
          "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE owner_id=$1 AND kind!='delete'",
          [owner],
        );
        await enqueue(
          c,
          owner,
          "delete",
          randomUUID(),
          { scope: "account" },
          `delete:account:${owner}`,
        );
      });
      return json({ deleted: true });
    }
    if (resource === "demo" && method === "POST") {
      if (env().ALLOW_DEMO !== "true") throw new AppError("NOT_FOUND", 404);
      const b = z
        .object({ locale: z.enum(["kk", "ru"]) })
        .parse(await body(req));
      const sample = syntheticDemo(b.locale);
      return json(
        await transaction(async (c) => {
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            owner + "demo",
          ]);
          const old = await c.query(
            "SELECT id,plan_id FROM generations WHERE owner_id=$1 AND demo=true AND locale=$2 AND deleted_at IS NULL",
            [owner, b.locale],
          );
          if (old.rowCount)
            return { id: old.rows[0].id, planId: old.rows[0].plan_id };
          const pid = randomUUID(),
            gid = randomUUID();
          await c.query(
            "INSERT INTO plans(id,owner_id,title,grade,locale,status) VALUES($1,$2,$3,7,$4,'confirmed')",
            [pid, owner, `DEMO • ${sample.row.topic}`, b.locale],
          );
          await c.query(
            "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version,grade,confirmed_at) VALUES($1,$2,1,$3,'synthetic',7,now())",
            [randomUUID(), pid, JSON.stringify([sample.row])],
          );
          await c.query(
            "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale,status,demo) VALUES($1,$2,$3,$4,$5,$6,$7,'needs_review',true)",
            [
              gid,
              owner,
              pid,
              sample.row.id,
              sample.snapshot,
              sample.document.title,
              b.locale,
            ],
          );
          await c.query(
            "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,1,$3,$4,'synthetic-no-provider','demo-1.0')",
            [
              randomUUID(),
              gid,
              sample.document,
              {
                status: "needs_review",
                demo: true,
                checks: ["synthetic"],
                limitations: [
                  "Prepared demonstration; AI generation was not used",
                ],
              },
            ],
          );
          return { id: gid, planId: pid };
        }),
        201,
      );
    }
    if (
      resource === "generations" &&
      id &&
      action === "document" &&
      method === "PATCH"
    ) {
      const b = z
        .object({
          revision: z.number().int().positive(),
          document: GenerationDoc,
        })
        .parse(await body(req));
      return json(
        await transaction(async (c) => {
          const g = (
            await c.query(
              "SELECT * FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
              [id, owner],
            )
          ).rows[0];
          if (!g) throw new AppError("NOT_FOUND", 404);
          if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
          const old = (
            await c.query(
              "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
              [id, g.revision],
            )
          ).rows[0];
          const existingIds = new Set(old.document.tasks.map((t: any) => t.id));
          if (
            b.document.tasks.some((t) => !existingIds.has(t.id)) ||
            b.document.tasks.length !== existingIds.size
          )
            throw new AppError("AI_INVALID", 422);
          const report = validateDocument(b.document, g.source_snapshot);
          if (
            report.issues.includes("SNAPSHOT_MISMATCH") ||
            report.issues.includes("LEVEL_COUNT") ||
            report.issues.includes("DUPLICATE_ID") ||
            b.document.tasks.some(
              (t) =>
                old.document.tasks.find((previous: any) => previous.id === t.id)
                  ?.level !== t.level,
            )
          )
            throw new AppError("AI_INVALID", 422);
          const revision = g.revision + 1;
          await c.query(
            "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              id,
              revision,
              b.document,
              { ...report, doc: undefined, stale: true },
              old.model,
              old.prompt_version,
            ],
          );
          await c.query(
            "UPDATE generations SET revision=$2,status='needs_review' WHERE id=$1",
            [id, revision],
          );
          return { revision };
        }),
      );
    }
    if (resource === "profile") {
      if (method === "GET") {
        await db().query(
          "INSERT INTO profiles(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
          [owner],
        );
        const profile = (
          await db().query(
            "SELECT school,locale,grades,styles FROM profiles WHERE owner_id=$1",
            [owner],
          )
        ).rows[0];
        return json({
          ...profile,
          styles: Styles.parse({
            font: env().DEFAULT_EXPORT_FONT,
            ...(profile.styles ?? {}),
          }),
          name: session.user.name,
          teachingSubject:
            (
              await db().query(
                'SELECT "teachingSubject" FROM "user" WHERE id=$1',
                [owner],
              )
            ).rows[0]?.teachingSubject ?? "",
          email: session.user.email,
          stats: (
            await db().query(
              `SELECT
            (SELECT count(*)::int FROM plans WHERE owner_id=$1 AND deleted_at IS NULL) AS "planCount",
            (SELECT count(*)::int FROM plans WHERE owner_id=$1 AND deleted_at IS NULL AND status='review') AS "reviewCount",
            (SELECT count(*)::int FROM exports e JOIN generations g ON g.id=e.generation_id WHERE e.owner_id=$1 AND e.deleted_at IS NULL AND g.deleted_at IS NULL AND e.status='succeeded') AS "documentCount"`,
              [owner],
            )
          ).rows[0],
          limits: { daily: env().DAILY_AI_LIMIT },
          capabilities: {
            directUploads: env().DIRECT_UPLOADS === "true",
            ai: !!env().OPENAI_API_KEY && !!env().OPENAI_MODEL,
            demo: env().ALLOW_DEMO === "true",
          },
        });
      }
      if (method === "PATCH") {
        const b = z
          .object({
            name: z.string().trim().min(1).max(100),
            teachingSubject: z.string().max(120).optional(),
            school: z.string().max(200),
            locale: z.enum(["kk", "ru"]),
            grades: z.array(z.number().int().min(1).max(11)).max(11),
            styles: Styles,
          })
          .parse(await body(req));
        await transaction(async (c) => {
          await c.query(
            'UPDATE "user" SET name=$2,"teachingSubject"=COALESCE($3,"teachingSubject"),"updatedAt"=now() WHERE id=$1',
            [owner, b.name, b.teachingSubject ?? null],
          );
          await c.query(
            "INSERT INTO profiles(owner_id,school,locale,grades,styles) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id) DO UPDATE SET school=$2,locale=$3,grades=$4,styles=$5",
            [owner, b.school, b.locale, JSON.stringify(b.grades), b.styles],
          );
        });
        return json({ saved: true });
      }
    }
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
      const extension = b.name.split(".").pop()?.toLowerCase();
      const mimes: Record<string, string> = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      if (!extension || !mimes[extension]) throw new AppError("FILE_TYPE", 415);
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
        const usage = (
          await c.query(
            "SELECT COALESCE(sum(bytes),0)::bigint AS bytes,count(*)::int AS count FROM uploads WHERE owner_id=$1 AND deleted_at IS NULL",
            [owner],
          )
        ).rows[0];
        if (
          Number(usage.bytes) + b.bytes > 500 * 1024 * 1024 ||
          usage.count >= 100
        )
          throw new AppError("LIMIT", 429);
        await c.query(
          "INSERT INTO uploads(id,owner_id,object_key,original_name,mime,bytes,checksum,scan_status,status) VALUES($1,$2,$3,$4,$5,$6,'','pending','pending')",
          [uploadId, owner, key, b.name, mimes[extension], b.bytes],
        );
      });
      try {
        return json(
          {
            id: uploadId,
            url: await signedUpload(key, b.bytes, mimes[extension]),
            contentType: mimes[extension],
            expiresIn: 300,
          },
          201,
        );
      } catch (error) {
        await db().query(
          "DELETE FROM uploads WHERE id=$1 AND status='pending'",
          [uploadId],
        );
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
      const meta = await objectMetadata(file.object_key);
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
      return await withUploadCapacity(async () => {
        const bounded = await boundedRequest(
          req,
          (env().MAX_UPLOAD_MB + 1) * 1024 * 1024,
        );
        const form = await bounded.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new AppError("FILE_INVALID", 400);
        if (!file.size || file.size > env().MAX_UPLOAD_MB * 1024 * 1024)
          throw new AppError("FILE_SIZE", 413);
        const usage = await db().query(
          "SELECT COALESCE(sum(bytes),0)::bigint AS bytes,count(*)::int AS count FROM uploads WHERE owner_id=$1 AND deleted_at IS NULL",
          [owner],
        );
        if (
          Number(usage.rows[0].bytes) + file.size > 500 * 1024 * 1024 ||
          usage.rows[0].count >= 100
        )
          throw new AppError("LIMIT", 429);
        const bytes = Buffer.from(await file.arrayBuffer());
        const type = await inspectFile(bytes, file.name);
        const uploadId = randomUUID();
        const key = `${owner}/uploads/${uploadId}.${type.ext}`;
        await putObject(key, bytes, type.mime);
        try {
          await transaction(async (c) => {
            await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
              owner + ":storage",
            ]);
            const current = await c.query(
              "SELECT COALESCE(sum(bytes),0)::bigint AS bytes,count(*)::int AS count FROM uploads WHERE owner_id=$1 AND deleted_at IS NULL",
              [owner],
            );
            if (
              Number(current.rows[0].bytes) + file.size > 500 * 1024 * 1024 ||
              current.rows[0].count >= 100
            )
              throw new AppError("LIMIT", 429);
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
          await deleteObject(key);
          throw e;
        }
        return json({ id: uploadId, name: file.name }, 201);
      });
    }
    if (resource === "uploads" && id && ["GET", "HEAD"].includes(method)) {
      const f = await owned("uploads", id, owner);
      if (
        !["clean", "unscanned-development"].includes(f.scan_status) ||
        f.status !== "complete"
      )
        throw new AppError("CONFLICT", 409);
      return await objectDownload(req, f.object_key, {
        "Content-Type": f.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
      });
    }
    if (resource === "ktp" && id === "imports" && method === "POST") {
      const b = z
        .object({
          uploadId: uid,
          locale: z.enum(["kk", "ru"]),
          includeHidden: z.boolean().default(false),
          grade: z.number().int().min(1).max(11).nullable().optional(),
        })
        .parse(await body(req));
      const f = await owned("uploads", b.uploadId, owner);
      if (f.status !== "complete" || f.scan_status === "rejected")
        throw new AppError("CONFLICT", 409);
      const result = await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          b.uploadId,
        ]);
        const locked = await c.query(
          "SELECT 1 FROM uploads WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [b.uploadId, owner],
        );
        if (!locked.rowCount) throw new AppError("NOT_FOUND", 404);
        const existing = await c.query(
          "SELECT id,resource_id FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
          [owner, `import:${b.uploadId}`],
        );
        if (existing.rowCount)
          return {
            id: existing.rows[0].resource_id,
            jobId: existing.rows[0].id,
          };
        const planId = randomUUID();
        await c.query(
          "INSERT INTO plans(id,owner_id,file_id,title,locale,grade) VALUES($1,$2,$3,$4,$5,$6)",
          [
            planId,
            owner,
            b.uploadId,
            f.original_name,
            b.locale,
            b.grade ?? null,
          ],
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
      const status = z
        .enum(["confirmed", "review", "extracting", "failed"])
        .optional()
        .parse(url.searchParams.get("status") ?? undefined);
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
    if (resource === "ktp" && id && action === "preview" && method === "GET") {
      const plan = await owned("plans", id, owner);
      const file = await owned("uploads", plan.file_id, owner);
      if (!["clean", "unscanned-development"].includes(file.scan_status))
        throw new AppError("CONFLICT", 409);
      if (file.mime !== "application/pdf") throw new AppError("FILE_TYPE", 415);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(150)
        .parse(url.searchParams.get("page") ?? "1");
      const preview = await isolatedRequest(
        "preview",
        await getObject(file.object_key),
        "pdf",
        { page },
      );
      return new Response(new Uint8Array(preview), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
        },
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
      const normalized = b.rows.map((r, i) => ({
        ...r,
        goalsSkipped: maySkipGoals(r),
        ...normalizeDate(r.dateSkipped ? "" : r.dateRaw),
        dateRaw: r.dateSkipped ? "" : r.dateRaw,
        objectiveCodes: r.goals.match(/\b\d{1,2}\.\d+\.\d+\.\d+\b/g) ?? [],
        sourceOrder: i + 1,
        warnings: r.warnings
          .filter(
            (w) =>
              w !== "objective_code_only" &&
              w !== "missing_objective_text" &&
              !w.includes("date"),
          )
          .concat(r.dateSkipped ? [] : normalizeDate(r.dateRaw).warnings)
          .concat(
            maySkipGoals(r)
              ? []
              : !r.goals.trim()
                ? ["missing_objective_text"]
                : !hasGoalText(r.goals)
                  ? ["objective_code_only"]
                  : [],
          ),
      }));
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
    if (resource === "jobs" && id) {
      const job = await owned("jobs", id, owner);
      if (method === "POST" && action === "retry") {
        if (
          !["import", "export"].includes(job.kind) ||
          !["failed", "cancelled"].includes(job.status)
        )
          throw new AppError("CONFLICT", 409);
        const table = job.kind === "import" ? "plans" : "exports";
        await owned(table, job.resource_id, owner);
        await transaction(async (c) => {
          const updated = await c.query(
            "UPDATE jobs SET status='queued',stage='queued',attempt=0,cancel_requested=false,error_code=NULL,available_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND owner_id=$2 AND status IN('failed','cancelled') RETURNING id",
            [id, owner],
          );
          if (!updated.rowCount) throw new AppError("CONFLICT", 409);
          await c.query(`UPDATE ${table} SET status=$2 WHERE id=$1`, [
            job.resource_id,
            job.kind === "import" ? "extracting" : "queued",
          ]);
        });
        return json({ jobId: id }, 202);
      }
      if (method === "GET")
        return json({
          id: job.id,
          kind: job.kind,
          status: job.status,
          stage: job.stage,
          attempt: job.attempt,
          cancelRequested: job.cancel_requested,
          error: job.error_code
            ? {
                code: job.error_code,
                message: messages[job.error_code] ?? messages.INTERNAL,
              }
            : null,
          result: job.result,
          resourceId: job.resource_id,
        });
      if (method === "POST" && action === "cancel") {
        await transaction(async (c) => {
          const cancelled = await c.query(
            "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,stage=CASE WHEN status='queued' THEN 'cancelled' ELSE stage END WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running') RETURNING kind,resource_id,status",
            [id, owner],
          );
          const row = cancelled.rows[0];
          if (row?.status === "cancelled") {
            await c.query(
              "UPDATE usage_ledger SET state='released' WHERE job_id=$1 AND state='reserved'",
              [id],
            );
            const table =
              row.kind === "import"
                ? "plans"
                : row.kind === "generate"
                  ? "generations"
                  : row.kind === "export"
                    ? "exports"
                    : null;
            if (table)
              await c.query(
                `UPDATE ${table} SET status='cancelled' WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
                [row.resource_id, owner],
              );
          }
        });
        return json({ cancelRequested: true });
      }
    }
    if (resource === "jobs" && !id && method === "GET")
      return json(
        (
          await db().query(
            "SELECT id,kind,status,stage,error_code,cancel_requested,resource_id,created_at FROM jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            [owner, limit, offset],
          )
        ).rows,
      );
    if (resource === "generations" && !id && method === "POST") {
      if (!env().OPENAI_API_KEY || !env().OPENAI_MODEL)
        throw new AppError("AI_UNAVAILABLE", 503);
      const b = GenerateInput.parse(await body(req));
      const plan = await currentPlan(b.planId, owner);
      if (plan.revision !== b.revision) throw new AppError("CONFLICT", 409);
      if (plan.status !== "confirmed") throw new AppError("UNCONFIRMED", 422);
      const row = (plan.rows as KtpRow[]).find((r) => r.id === b.rowId);
      if (!row || !hasRequiredGoals(row) || !rowGrade(row, plan.grade))
        throw new AppError("UNCONFIRMED", 422);
      const key = req.headers.get("idempotency-key");
      uid.parse(key);
      const result = await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          owner + key,
        ]);
        const requestHash = createHash("sha256")
          .update(JSON.stringify(b))
          .digest("hex");
        const old = await c.query(
          "SELECT id,resource_id,kind,payload FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
          [owner, key],
        );
        if (old.rowCount) {
          if (
            old.rows[0].kind !== "generate" ||
            old.rows[0].payload.requestHash !== requestHash
          )
            throw new AppError("CONFLICT", 409);
          return { id: old.rows[0].resource_id, jobId: old.rows[0].id };
        }
        const gid = randomUUID();
        const locked = await c.query(
          "SELECT 1 FROM plans WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND revision=$3 AND status=$4 FOR UPDATE",
          [plan.id, owner, plan.revision, "confirmed"],
        );
        if (!locked.rowCount) throw new AppError("CONFLICT", 409);
        const snapshot = {
          id: randomUUID(),
          topic: row.topic,
          goals: maySkipGoals(row) ? "" : row.goals,
          goalsSkipped: maySkipGoals(row),
          objectiveCodes: maySkipGoals(row)
            ? ["assessment"]
            : row.objectiveCodes.length
              ? row.objectiveCodes
              : ["manual"],
          grade: rowGrade(row, plan.grade),
          subject:
            (
              await c.query(
                'SELECT "teachingSubject" FROM "user" WHERE id=$1',
                [owner],
              )
            ).rows[0]?.teachingSubject || "general",
          locale: b.locale,
          count: b.count,
          minutes: b.minutes,
          constraints: b.constraints,
          format: b.format,
          planRevision: plan.revision,
        };
        await c.query(
          "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [gid, owner, plan.id, row.id, snapshot, row.topic, b.locale],
        );
        const jobId = await enqueue(
          c,
          owner,
          "generate",
          gid,
          { requestHash },
          key!,
        );
        await reserveQuota(c, owner, jobId);
        return { id: gid, jobId };
      });
      return json(result, 202);
    }
    if (resource === "generations" && id && !action && method === "GET") {
      const revision = url.searchParams.get("revision");
      return json(
        await currentGeneration(
          id,
          owner,
          revision ? Number(revision) : undefined,
        ),
      );
    }
    if (
      resource === "generations" &&
      id &&
      action === "versions" &&
      method === "GET"
    ) {
      await owned("generations", id, owner);
      return json(
        (
          await db().query(
            "SELECT revision,created_at FROM generation_versions WHERE generation_id=$1 ORDER BY revision DESC",
            [id],
          )
        ).rows,
      );
    }
    if (
      resource === "generations" &&
      id &&
      action === "tasks" &&
      child &&
      method === "PATCH"
    ) {
      const b = z
        .object({ revision: z.number().int().positive(), task: Task })
        .parse(await body(req));
      if (b.task.id !== child) throw new AppError("FILE_INVALID", 422);
      return json(
        await transaction(async (c) => {
          const g = (
            await c.query(
              "SELECT * FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
              [id, owner],
            )
          ).rows[0];
          if (!g) throw new AppError("NOT_FOUND", 404);
          if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
          const old = (
            await c.query(
              "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
              [id, b.revision],
            )
          ).rows[0];
          const index = old.document.tasks.findIndex(
            (t: any) => t.id === child,
          );
          if (index < 0) throw new AppError("NOT_FOUND", 404);
          if (b.task.level !== old.document.tasks[index].level)
            throw new AppError("AI_INVALID", 422);
          old.document.tasks[index] = b.task;
          const report = validateDocument(old.document, g.source_snapshot);
          const revision = b.revision + 1;
          await c.query(
            "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              id,
              revision,
              old.document,
              { ...report, doc: undefined, stale: true },
              old.model,
              old.prompt_version,
            ],
          );
          await c.query(
            "UPDATE generations SET revision=$2,status='needs_review' WHERE id=$1",
            [id, revision],
          );
          return { revision };
        }),
      );
    }
    if (
      resource === "generations" &&
      id &&
      action === "tasks" &&
      child &&
      path[4] === "regenerate" &&
      method === "POST"
    ) {
      const g = await currentGeneration(id, owner);
      if (g.demo) throw new AppError("AI_UNAVAILABLE", 503);
      const b = z
        .object({ revision: z.number().int().positive() })
        .parse(await body(req));
      if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
      if (!g.document.tasks.some((t: any) => t.id === child))
        throw new AppError("NOT_FOUND", 404);
      const key = uid.parse(req.headers.get("idempotency-key"));
      const jobId = await transaction(async (c) => {
        const locked = (
          await c.query(
            "SELECT revision FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [id, owner],
          )
        ).rows[0];
        if (!locked) throw new AppError("NOT_FOUND", 404);
        if (locked.revision !== b.revision) throw new AppError("CONFLICT", 409);
        const j = await enqueue(
          c,
          owner,
          "regenerate",
          id,
          { taskId: child, revision: b.revision },
          key,
        );
        const old = await c.query(
          "SELECT 1 FROM usage_ledger WHERE job_id=$1",
          [j],
        );
        if (!old.rowCount) await reserveQuota(c, owner, j);
        return j;
      });
      return json({ jobId }, 202);
    }
    if (
      resource === "generations" &&
      id &&
      action === "approve" &&
      method === "POST"
    ) {
      const b = z
        .object({
          revision: z.number().int().positive(),
          teacherReviewed: z.literal(true),
        })
        .parse(await body(req));
      return json(
        await transaction(async (c) => {
          const g = (
            await c.query(
              "SELECT * FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
              [id, owner],
            )
          ).rows[0];
          if (!g) throw new AppError("NOT_FOUND", 404);
          if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
          const v = (
            await c.query(
              "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
              [id, b.revision],
            )
          ).rows[0];
          if (!v) throw new AppError("REVIEW_REQUIRED", 422);
          const report = validateDocument(v.document, g.source_snapshot);
          if (report.issues.length) throw new AppError("REVIEW_REQUIRED", 422);
          // An in-flight regeneration can replace the document. Let it finish before approval.
          const pending = await c.query(
            "SELECT 1 FROM jobs WHERE resource_id=$1 AND kind IN ('generate','regenerate') AND status IN ('queued','running')",
            [id],
          );
          if (pending.rowCount) throw new AppError("CONFLICT", 409);
          const approved = (
            await c.query(
              "UPDATE generation_versions SET reviewed_at=COALESCE(reviewed_at,now()),reviewed_by=$3,validation=$4 WHERE generation_id=$1 AND revision=$2 RETURNING reviewed_at",
              [id, b.revision, owner, { ...report, doc: undefined }],
            )
          ).rows[0];
          await c.query(
            "UPDATE generations SET status='approved' WHERE id=$1",
            [id],
          );
          return { revision: b.revision, reviewedAt: approved.reviewed_at };
        }),
      );
    }
    if (
      resource === "generations" &&
      id &&
      action === "validate" &&
      method === "POST"
    ) {
      const g = await currentGeneration(id, owner);
      if (!g.document) throw new AppError("CONFLICT", 409);
      const report = validateDocument(g.document, g.source_snapshot);
      await db().query(
        "UPDATE generation_versions SET validation=$3 WHERE generation_id=$1 AND revision=$2",
        [id, g.revision, { ...report, doc: undefined }],
      );
      return json({ ...report, doc: undefined });
    }
    if (resource === "exports" && !id && method === "POST") {
      const b = z
        .object({
          generationId: uid,
          revision: z.number().int().positive(),
          format: z.enum(["docx", "pdf"]),
          audience: z.enum(["full", "student"]),
          styles: Styles,
          teacherReviewed: z.boolean().default(false),
        })
        .parse(await body(req));
      const g = await currentGeneration(b.generationId, owner, b.revision);
      if (!g.document) throw new AppError("NOT_FOUND", 404);
      if (!g.reviewed_at || g.reviewed_by !== owner || !b.teacherReviewed)
        throw new AppError("REVIEW_REQUIRED", 422);
      if (
        b.teacherReviewed &&
        validateDocument(g.document, g.source_snapshot).issues.length
      )
        throw new AppError("REVIEW_REQUIRED", 422);
      const key = uid.parse(req.headers.get("idempotency-key"));
      const result = await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          owner + key,
        ]);
        const requestHash = createHash("sha256")
          .update(JSON.stringify(b))
          .digest("hex");
        const old = await c.query(
          "SELECT id,resource_id,kind,payload FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
          [owner, key],
        );
        if (old.rowCount) {
          if (
            old.rows[0].kind !== "export" ||
            old.rows[0].payload.requestHash !== requestHash
          )
            throw new AppError("CONFLICT", 409);
          return { id: old.rows[0].resource_id, jobId: old.rows[0].id };
        }
        const count = await c.query(
          "SELECT count(*)::int FROM exports WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
          [owner],
        );
        if (count.rows[0].count >= 100) throw new AppError("LIMIT", 429);
        const eid = randomUUID();
        const locked = await c.query(
          "SELECT revision FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [g.id, owner],
        );
        if (!locked.rowCount) throw new AppError("NOT_FOUND", 404);
        if (locked.rows[0].revision !== b.revision)
          throw new AppError("CONFLICT", 409);
        const pending = await c.query(
          "SELECT 1 FROM jobs WHERE resource_id=$1 AND kind IN ('generate','regenerate') AND status IN ('queued','running')",
          [g.id],
        );
        if (pending.rowCount) throw new AppError("CONFLICT", 409);
        await c.query(
          "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,teacher_reviewed) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            eid,
            owner,
            g.id,
            g.versionId,
            b.format,
            b.audience,
            b.styles,
            b.teacherReviewed,
          ],
        );
        return {
          id: eid,
          jobId: await enqueue(c, owner, "export", eid, { requestHash }, key),
        };
      });
      return json(result, 202);
    }
    if (
      resource === "exports" &&
      id &&
      action === "download" &&
      ["GET", "HEAD"].includes(method)
    ) {
      const ex = await owned("exports", id, owner);
      await owned("generations", ex.generation_id, owner);
      if (!ex.teacher_reviewed) throw new AppError("REVIEW_REQUIRED", 422);
      if (ex.status !== "succeeded" || !ex.object_key)
        throw new AppError("CONFLICT", 409);
      return await objectDownload(req, ex.object_key, {
        "Content-Type":
          ex.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="ZiyatAI-${ex.audience}.${ex.format}"`,
      });
    }
    if (["history", "library"].includes(resource) && method === "GET") {
      const q = `%${(url.searchParams.get("q") ?? "").slice(0, 200)}%`;
      return json(
        resource === "history"
          ? (
              await db().query(
                "SELECT id,title,locale,status,revision,demo,created_at FROM generations WHERE owner_id=$1 AND deleted_at IS NULL AND title ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4",
                [owner, q, limit, offset],
              )
            ).rows
          : (
              await db().query(
                "SELECT e.id,e.format,e.audience,e.status,e.created_at,e.teacher_reviewed,g.id AS generation_id,g.title,v.revision FROM exports e JOIN generations g ON g.id=e.generation_id JOIN generation_versions v ON v.id=e.generation_version_id WHERE e.owner_id=$1 AND e.deleted_at IS NULL AND g.deleted_at IS NULL AND g.title ILIKE $2 ORDER BY e.created_at DESC,e.id DESC LIMIT $3 OFFSET $4",
                [owner, q, limit, offset],
              )
            ).rows,
      );
    }
    if (
      ["ktp", "generations", "exports"].includes(resource) &&
      id &&
      method === "DELETE"
    ) {
      const table =
        resource === "ktp" ? "plans" : (resource as "generations" | "exports");
      await owned(table, id, owner);
      await transaction(async (c) => {
        await c.query(`UPDATE ${table} SET deleted_at=now() WHERE id=$1`, [id]);
        if (table === "plans") {
          await c.query(
            "UPDATE uploads SET deleted_at=now() WHERE id=(SELECT file_id FROM plans WHERE id=$1)",
            [id],
          );
          await c.query(
            "UPDATE generations SET deleted_at=now() WHERE plan_id=$1",
            [id],
          );
        }
        if (table !== "exports")
          await c.query(
            "UPDATE exports SET deleted_at=now() WHERE generation_id IN(SELECT id FROM generations WHERE id=$1 OR plan_id=$1)",
            [id],
          );
        await c.query(
          "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE owner_id=$1 AND kind!='delete' AND (resource_id=$2 OR resource_id IN(SELECT id FROM generations WHERE deleted_at IS NOT NULL AND owner_id=$1) OR resource_id IN(SELECT id FROM exports WHERE deleted_at IS NOT NULL AND owner_id=$1))",
          [owner, id],
        );
        await enqueue(
          c,
          owner,
          "delete",
          id,
          { scope: table },
          `delete:${table}:${id}`,
        );
      });
      await audit(owner, "delete", id, requestId);
      return json({ deleted: true });
    }
    throw new AppError("NOT_FOUND", 404);
  } catch (e) {
    const error =
      e instanceof AppError
        ? e
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? new AppError("FILE_INVALID", 422)
          : new AppError("INTERNAL", 500);
    console.error(
      JSON.stringify({ requestId, outcome: "failed", code: error.code }),
    );
    const response = json(
      {
        code: error.code,
        message: messages[error.code] ?? messages.INTERNAL,
        requestId,
        fieldErrors: error.fieldErrors,
        ...(error instanceof ReadBudgetError
          ? { retryAfter: error.retryAfter }
          : {}),
      },
      error.status,
    );
    if (error instanceof ReadBudgetError)
      response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
}
