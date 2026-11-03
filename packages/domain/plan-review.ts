import type { KtpRow } from "../contracts";
import { normalizeDate } from "./dates";
import { rowGrade } from "./grades";
import { hasGoalText, hasRequiredGoals, maySkipGoals } from "./goals";

export type PlanIssueField = "topic" | "goals" | "grade";
export function planIssues(rows: KtpRow[], grade: number | null) {
  return rows.flatMap((row, index) => {
    const fields: PlanIssueField[] = [];
    if (!row.topic.trim()) fields.push("topic");
    if (!hasRequiredGoals(row)) fields.push("goals");
    if (!rowGrade(row, grade)) fields.push("grade");
    return fields.length ? [{ id: row.id, index, fields }] : [];
  });
}
export function canConfirmPlan(rows: KtpRow[], grade: number | null) {
  return rows.length > 0 && planIssues(rows, grade).length === 0;
}

/** Canonical source order, dates and warnings are derived from actual row text. */
export function normalizePlanRows(rows: KtpRow[]): KtpRow[] {
  return rows.map((row, index) => {
    const skipped = maySkipGoals(row);
    const date = normalizeDate(row.dateSkipped ? "" : row.dateRaw);
    return {
      ...row,
      dateSkipped: !!row.dateSkipped,
      goalsSkipped: skipped,
      dateStart: date.dateStart,
      dateEnd: date.dateEnd,
      dateRaw: row.dateSkipped ? "" : row.dateRaw,
      objectiveCodes: row.goals.match(/\b\d{1,2}\.\d+\.\d+\.\d+\b/g) ?? [],
      sourceOrder: index + 1,
      warnings: [
        ...new Set([
          ...row.warnings.filter(
            (w) =>
              w !== "objective_code_only" &&
              w !== "missing_objective_text" &&
              !w.includes("date"),
          ),
          ...(row.dateSkipped ? [] : date.warnings),
          ...(skipped
            ? []
            : !row.goals.trim()
              ? ["missing_objective_text"]
              : !hasGoalText(row.goals)
                ? ["objective_code_only"]
                : []),
        ]),
      ],
    };
  });
}
