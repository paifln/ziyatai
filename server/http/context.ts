import { planGrades } from "../../packages/domain/grades";
import { canConfirmPlan } from "../../packages/domain/plan-review";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readSupabaseSession } from "../auth/server";
import { db, transaction } from "../infrastructure/database/db";
import { AppError } from "../../packages/domain/errors";
import { type KtpRow } from "../../packages/contracts";
import { isEditablePlanStatus } from "../../packages/domain/plan-status";
export const uid = z.string().uuid();

export async function owned(
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

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function audit(
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

export async function currentPlan(id: string, owner: string) {
  const plan = await owned("plans", id, owner);
  const v = await db().query(
    "SELECT * FROM plan_versions WHERE plan_id=$1 AND revision=$2",
    [id, plan.revision],
  );
  return { ...plan, ...v.rows[0], id: plan.id };
}

export async function currentGeneration(
  id: string,
  owner: string,
  revision?: number,
) {
  const g = await owned("generations", id, owner);
  const v = await db().query(
    "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
    [id, revision ?? g.revision],
  );
  return { ...g, ...v.rows[0], id: g.id, versionId: v.rows[0]?.id };
}

export async function savePlan(
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
    if (!old || !isEditablePlanStatus(p.rows[0].status))
      throw new AppError("CONFLICT", 409);
    if (confirm && !canConfirmPlan(rows, grade))
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
      "UPDATE plans SET revision=$2,status=$3,grade=$4,school_year=$5,grades=$6 WHERE id=$1",
      [
        id,
        revision,
        confirm ? "confirmed" : "review",
        grade,
        year,
        planGrades(rows, grade),
      ],
    );
    return { revision };
  });
}
export type ApiContext = {
  req: Request;
  path: string[];
  resource: string;
  id: string;
  action: string;
  child: string;
  method: string;
  url: URL;
  owner: string;
  session: NonNullable<Awaited<ReturnType<typeof readSupabaseSession>>>;
  requestId: string;
  limit: number;
  offset: number;
};
