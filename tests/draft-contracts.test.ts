import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DraftWrite, PlanDraftSchema } from "../packages/contracts/drafts";

it("bounds draft identity, revision, sequence, class and year without arbitrary properties", () => {
  const value = {
    id: randomUUID(),
    kind: "ktp",
    resourceId: randomUUID(),
    baseRevision: 1,
    sequence: 1,
    draft: { rows: [], grade: 7, schoolYear: "2026–2027" },
  };
  expect(DraftWrite.safeParse(value).success).toBe(true);
  for (const changed of [
    { id: "../other" },
    { kind: "uploads" },
    { resourceId: "1 OR 1=1" },
    { baseRevision: 0 },
    { sequence: 0 },
    { ownerId: randomUUID() },
  ])
    expect(DraftWrite.safeParse({ ...value, ...changed }).success).toBe(false);
  expect(
    PlanDraftSchema.safeParse({ rows: [], grade: 12, schoolYear: "2026" })
      .success,
  ).toBe(false);
  expect(
    PlanDraftSchema.safeParse({
      rows: [],
      grade: null,
      schoolYear: "x".repeat(21),
    }).success,
  ).toBe(false);
});
