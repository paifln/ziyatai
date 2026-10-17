import { z } from "zod";
import type { PoolClient } from "pg";
import {
  DraftResource,
  DraftWrite,
  type DraftKind,
  PlanDraftSchema,
  type PlanDraft,
} from "../../../packages/contracts/drafts";
import { expandPlanDraft } from "../../../packages/domain/draft-payload";
import { AppError } from "../../../packages/domain/errors";
import { db, transaction } from "./db";
import { readJsonBody } from "./request-body";

const uuid = z.string().uuid();
const tables = {
  ktp: { resource: "plans", version: "plan_versions", column: "plan_id" },
  generation: {
    resource: "generations",
    version: "generation_versions",
    column: "generation_id",
  },
} as const;
async function owned(
  c: Pick<PoolClient, "query">,
  owner: string,
  kind: DraftKind,
  resourceId: string,
  lock = false,
) {
  const table = tables[kind];
  const resource = await c.query(
    `SELECT id FROM ${table.resource} WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL${lock ? " FOR SHARE" : ""}`,
    [resourceId, owner],
  );
  if (!resource.rowCount) throw new AppError("NOT_FOUND", 404);
}
async function baseline(
  c: Pick<PoolClient, "query">,
  kind: DraftKind,
  resourceId: string,
  revision: number,
) {
  const table = tables[kind];
  const columns = kind === "ktp" ? "rows,grade,school_year" : "document";
  const result = await c.query(
    `SELECT ${columns} FROM ${table.version} WHERE ${table.column}=$1 AND revision=$2`,
    [resourceId, revision],
  );
  const row = result.rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  return kind === "ktp"
    ? { rows: row.rows, grade: row.grade, schoolYear: row.school_year }
    : row.document;
}
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
function summary(row: any) {
  return {
    id: row.id,
    baseRevision: row.base_revision,
    sequence: row.sequence,
    savedAt: row.saved_at,
    expiresAt: row.expires_at,
  };
}
async function lockOwner(c: PoolClient, owner: string) {
  await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [owner]);
  await c.query(
    "DELETE FROM editor_drafts WHERE id IN (SELECT id FROM editor_drafts WHERE owner_id=$1 AND expires_at<=now() LIMIT 200)",
    [owner],
  );
}
async function capacity(
  c: PoolClient,
  owner: string,
  id: string,
  active: boolean,
) {
  const count = await c.query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE discarded_at IS NULL)::int AS active FROM editor_drafts WHERE owner_id=$1 AND id<>$2",
    [owner, id],
  );
  if (count.rows[0].total >= 200 || (active && count.rows[0].active >= 20))
    throw new AppError("DRAFT_LIMIT", 429);
}
async function rejected(
  c: PoolClient,
  owner: string,
  id: string,
  plan: string | null,
  generation: string | null,
): Promise<never> {
  const result = await c.query(
    "SELECT 1 FROM editor_drafts WHERE id=$1 AND owner_id=$2 AND plan_id IS NOT DISTINCT FROM $3::uuid AND generation_id IS NOT DISTINCT FROM $4::uuid",
    [id, owner, plan, generation],
  );
  throw new AppError(
    result.rowCount ? "CONFLICT" : "NOT_FOUND",
    result.rowCount ? 409 : 404,
  );
}

/** Authentication, gateway validation, CSRF and write rate limits run in handle(). */
export async function editorDrafts(
  req: Request,
  path: string[],
  owner: string,
): Promise<Response> {
  const [, id, action] = path,
    url = new URL(req.url);
  if (!id && req.method === "GET" && path.length === 1) {
    const resource = DraftResource.parse({
      kind: url.searchParams.get("kind"),
      resourceId: url.searchParams.get("resourceId"),
    });
    await owned(db(), owner, resource.kind, resource.resourceId);
    const result = await db().query(
      `SELECT id,base_revision,sequence,saved_at,expires_at FROM editor_drafts WHERE owner_id=$1 AND ${tables[resource.kind].column}=$2 AND discarded_at IS NULL AND expires_at>now() ORDER BY saved_at DESC,id DESC LIMIT 20`,
      [owner, resource.resourceId],
    );
    return reply(result.rows.map(summary));
  }
  if (id && !action && req.method === "GET" && path.length === 2) {
    uuid.parse(id);
    const result = await db().query(
      "SELECT * FROM editor_drafts WHERE id=$1 AND owner_id=$2 AND discarded_at IS NULL AND expires_at>now()",
      [id, owner],
    );
    const row = result.rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    const kind = row.plan_id ? "ktp" : "generation",
      resourceId = row.plan_id ?? row.generation_id;
    await owned(db(), owner, kind, resourceId);
    return reply({
      ...summary(row),
      kind,
      resourceId,
      draft: row.payload,
      base: await baseline(db(), kind, resourceId, row.base_revision),
    });
  }
  if (!id && req.method === "POST" && path.length === 1) {
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch (error) {
      if (error instanceof AppError && error.code === "FILE_SIZE")
        throw new AppError("DRAFT_SIZE", 413);
      throw error;
    }
    const input = DraftWrite.parse(raw);
    const result = await transaction(async (c) => {
      await lockOwner(c, owner);
      await owned(c, owner, input.kind, input.resourceId, true);
      const base = await baseline(
        c,
        input.kind,
        input.resourceId,
        input.baseRevision,
      );
      if (input.kind === "ktp") {
        try {
          input.draft = PlanDraftSchema.parse(
            expandPlanDraft(base as PlanDraft, input.draft),
          );
        } catch {
          throw new AppError("FILE_INVALID", 422);
        }
        if (
          new Set(input.draft.rows.map((row) => row.id)).size !==
          input.draft.rows.length
        )
          throw new AppError("FILE_INVALID", 422);
      } else {
        const previous = base as typeof input.draft;
        if (
          previous.sourceSnapshotId !== input.draft.sourceSnapshotId ||
          previous.tasks.length !== input.draft.tasks.length ||
          input.draft.tasks.some(
            (task) =>
              !previous.tasks.some(
                (old) => old.id === task.id && old.level === task.level,
              ),
          ) ||
          new Set(input.draft.tasks.map((task) => task.id)).size !==
            input.draft.tasks.length
        )
          throw new AppError("FILE_INVALID", 422);
      }
      await capacity(c, owner, input.id, true);
      const payload = JSON.stringify(input.draft);
      // References reduce transfer size, not the account's storage allowance.
      if (Buffer.byteLength(payload, "utf8") > 2 * 1024 * 1024)
        throw new AppError("DRAFT_SIZE", 413);
      const plan = input.kind === "ktp" ? input.resourceId : null,
        generation = input.kind === "generation" ? input.resourceId : null;
      const saved = await c.query(
        "INSERT INTO editor_drafts(id,owner_id,plan_id,generation_id,base_revision,sequence,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET base_revision=excluded.base_revision,sequence=excluded.sequence,payload=excluded.payload,saved_at=now(),expires_at=now()+interval '7 days' WHERE editor_drafts.owner_id=excluded.owner_id AND editor_drafts.plan_id IS NOT DISTINCT FROM excluded.plan_id AND editor_drafts.generation_id IS NOT DISTINCT FROM excluded.generation_id AND editor_drafts.discarded_at IS NULL AND (editor_drafts.sequence<excluded.sequence OR (editor_drafts.sequence=excluded.sequence AND editor_drafts.base_revision=excluded.base_revision AND editor_drafts.payload=excluded.payload)) RETURNING *",
        [
          input.id,
          owner,
          plan,
          generation,
          input.baseRevision,
          input.sequence,
          payload,
        ],
      );
      if (!saved.rowCount) await rejected(c, owner, input.id, plan, generation);
      return summary(saved.rows[0]);
    });
    return reply(result);
  }
  if (
    id &&
    action === "discard" &&
    req.method === "POST" &&
    path.length === 3
  ) {
    uuid.parse(id);
    const input = DraftResource.extend({
      expectedSequence: z.number().int().nonnegative().optional(),
    }).parse(await readJsonBody(req));
    await transaction(async (c) => {
      await lockOwner(c, owner);
      await owned(c, owner, input.kind, input.resourceId, true);
      await capacity(c, owner, id, false);
      const plan = input.kind === "ktp" ? input.resourceId : null,
        generation = input.kind === "generation" ? input.resourceId : null;
      const result = await c.query(
        "INSERT INTO editor_drafts(id,owner_id,plan_id,generation_id,base_revision,sequence,payload,discarded_at,expires_at) VALUES($1,$2,$3,$4,1,0,NULL,now(),now()+interval '1 hour') ON CONFLICT(id) DO UPDATE SET payload=NULL,discarded_at=now(),expires_at=now()+interval '1 hour' WHERE editor_drafts.owner_id=excluded.owner_id AND editor_drafts.plan_id IS NOT DISTINCT FROM excluded.plan_id AND editor_drafts.generation_id IS NOT DISTINCT FROM excluded.generation_id AND ($5::integer IS NULL OR editor_drafts.sequence=$5) RETURNING id",
        [id, owner, plan, generation, input.expectedSequence ?? null],
      );
      if (!result.rowCount) await rejected(c, owner, id, plan, generation);
    });
    return reply({ discarded: true });
  }
  throw new AppError("NOT_FOUND", 404);
}
