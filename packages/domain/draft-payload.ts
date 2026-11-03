import type { PlanDraft } from "../contracts/drafts";
import { draftsEqual } from "./merge-drafts";

/** References always resolve against the immutable, owned baseRevision. */
type ReferencedPlanDraft = Omit<PlanDraft, "rows"> & {
  encoding: "row-references-v1";
  rows: (string | PlanDraft["rows"][number])[];
};
export function compactPlanDraft(
  base: PlanDraft,
  draft: PlanDraft,
): PlanDraft | ReferencedPlanDraft {
  const original: Record<string, PlanDraft["rows"][number]> =
    Object.create(null);
  base.rows.forEach((row) => {
    original[row.id] = row;
  });
  let references = 0;
  const compact: ReferencedPlanDraft = {
    encoding: "row-references-v1",
    grade: draft.grade,
    schoolYear: draft.schoolYear,
    rows: draft.rows.map((row) => {
      if (!original[row.id] || !draftsEqual(original[row.id], row)) return row;
      references++;
      return row.id;
    }),
  };
  // Even one valid Row has more fixed field names than the reference and
  // encoding overhead. Avoid serializing the entire plan merely to compare sizes.
  return references ? compact : draft;
}
export function expandPlanDraft(
  base: PlanDraft,
  draft: PlanDraft | ReferencedPlanDraft,
): PlanDraft {
  if (!("encoding" in draft)) return draft;
  const original: Record<string, PlanDraft["rows"][number]> =
    Object.create(null);
  base.rows.forEach((row) => {
    original[row.id] = row;
  });
  return {
    grade: draft.grade,
    schoolYear: draft.schoolYear,
    rows: draft.rows.map((row) => {
      if (typeof row !== "string") return row;
      if (!original[row]) throw new Error("Unknown baseline row reference");
      return original[row];
    }),
  };
}
