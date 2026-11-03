import type { PoolClient, QueryResult } from "pg";
import type { KtpRow } from "../../packages/contracts";
import { planGrades } from "../../packages/domain/grades";
type PlanGradeRecord = { id: string; grade: number | null; rows: KtpRow[] | null };

/** Bounded batches; use exactly the same sheet-label rules as import and editing. */
export async function backfillPlanGrades(client: PoolClient) {
  let cursor: string | null = null;
  for (;;) {
    const batch: QueryResult<PlanGradeRecord> = await client.query<PlanGradeRecord>(
      `SELECT p.id,p.grade,v.rows FROM plans p
       LEFT JOIN plan_versions v ON v.plan_id=p.id AND v.revision=p.revision
       WHERE p.grades IS NULL AND ($1::uuid IS NULL OR p.id>$1::uuid)
       ORDER BY p.id LIMIT 100 FOR UPDATE OF p`,
      [cursor],
    );
    if (!batch.rows.length) return;
    for (const plan of batch.rows) {
      const grades = plan.rows?.length
        ? planGrades(plan.rows, plan.grade)
        : plan.grade === null
          ? []
          : [plan.grade];
      await client.query("UPDATE plans SET grades=$2 WHERE id=$1", [
        plan.id,
        grades,
      ]);
      cursor = plan.id;
    }
  }
}
