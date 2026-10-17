import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  compactPlanDraft,
  expandPlanDraft,
} from "../packages/domain/draft-payload";
import {
  DraftWrite,
  PlanDraftSchema,
  type PlanDraft,
} from "../packages/contracts/drafts";

function plan(count: number): PlanDraft {
  return {
    grade: 7,
    schoolYear: "2026–2027",
    rows: Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      sourceOrder: index + 1,
      lessonNumberRaw: String(index + 1),
      section: "Алгебра",
      quarter: "1",
      topic: "Линейные уравнения",
      goals: "Решать линейные уравнения и проверять найденные решения. ".repeat(
        3,
      ),
      objectiveCodes: ["7.2.2.1"],
      lessonGoals: "",
      hours: "1",
      dateRaw: "",
      dateSkipped: true,
      dateStart: null,
      dateEnd: null,
      notes: "",
      warnings: [],
      source: {
        page: null,
        sheet: "7 класс",
        range: `A${index + 1}:H${index + 1}`,
        fragment: "Линейные уравнения",
        method: "digital",
        confidence: 1,
      },
    })),
  };
}

it("round-trips edited, added, removed and reordered rows without changing source metadata", () => {
  const base = plan(5),
    next = structuredClone(base);
  next.rows[1].topic = "Жаңа тақырып";
  next.rows[1].goalsSkipped = true;
  next.rows.splice(2, 1);
  next.rows.reverse();
  next.rows.push(plan(1).rows[0]);
  next.grade = 8;
  next.schoolYear = "2027–2028";
  const input = compactPlanDraft(base, next);
  expect("encoding" in input).toBe(true);
  expect(input.rows.filter((row) => typeof row === "string")).toHaveLength(3);
  expect(expandPlanDraft(base, input)).toEqual(next);
  expect(PlanDraftSchema.parse(expandPlanDraft(base, input))).toEqual(next);
  expect(base.rows).toHaveLength(5);
  expect(base.rows[1].topic).toBe("Линейные уравнения");
  const allChanged = structuredClone(base);
  allChanged.rows.forEach((row) => {
    row.notes = "Изменено";
  });
  expect(compactPlanDraft(base, allChanged)).toBe(allChanged);
});

it("reduces a 2000-row single-edit payload by more than 90% while preserving all rows", () => {
  const base = plan(2000),
    next = structuredClone(base);
  next.rows[1999].topic = "Последняя исправленная тема";
  const compact = compactPlanDraft(base, next);
  expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(
    Buffer.byteLength(JSON.stringify(next)) * 0.1,
  );
  expect(expandPlanDraft(base, compact)).toEqual(next);
  expect(PlanDraftSchema.safeParse(next).success).toBe(true);
});

it("rejects unknown references and validates the wire encoding rather than trusting arbitrary objects", () => {
  const base = plan(1);
  const payload = {
    encoding: "row-references-v1" as const,
    rows: [randomUUID()],
    grade: 7,
    schoolYear: "",
  };
  expect(() => expandPlanDraft(base, payload)).toThrow(
    "Unknown baseline row reference",
  );
  const input = {
    id: randomUUID(),
    resourceId: randomUUID(),
    baseRevision: 1,
    sequence: 1,
    kind: "ktp",
    draft: payload,
  };
  expect(DraftWrite.safeParse(input).success).toBe(true);
  expect(
    DraftWrite.safeParse({
      ...input,
      draft: { ...payload, rows: ["__proto__"] },
    }).success,
  ).toBe(false);
  expect(
    DraftWrite.safeParse({
      ...input,
      draft: { ...payload, encoding: "unknown" },
    }).success,
  ).toBe(false);
  expect(
    DraftWrite.safeParse({ ...input, draft: { ...payload, extra: true } })
      .success,
  ).toBe(false);
});

it("uses the same compact transport in Lite without modern collection APIs", () => {
  const window: any = {};
  runInNewContext(
    "Set=undefined;Symbol=undefined;Object.hasOwn=undefined;Object.fromEntries=undefined;" +
      readFileSync("public/lite/draft-merge.js", "utf8"),
    { window },
  );
  const base = plan(4),
    next = structuredClone(base);
  next.rows[3].notes = "СОЧ";
  const wire = window.ZiyatDraftPayload.compactPlanDraft(base, next);
  expect(JSON.stringify(wire)).toBe(
    JSON.stringify(compactPlanDraft(base, next)),
  );
  expect(
    JSON.stringify(window.ZiyatDraftPayload.expandPlanDraft(base, wire)),
  ).toBe(JSON.stringify(next));
});
