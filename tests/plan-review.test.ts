import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { syntheticDemo } from "../packages/domain/demo";
import { Row } from "../packages/contracts";
import {
  canConfirmPlan,
  normalizePlanRows,
  planIssues,
} from "../packages/domain/plan-review";

it("matches server defaults so a committed save with a lost response can synchronize without another revision", () => {
  const { row } = syntheticDemo("ru");
  const local = normalizePlanRows([{ ...row, topic: "Правка" }]);
  const canonical = normalizePlanRows([Row.parse({ ...row, topic: "Правка" })]);
  expect(local).toEqual(canonical);
  expect(local[0].dateSkipped).toBe(false);
});

it("reports missing fields across every class without guessing class from objective codes", () => {
  const { row } = syntheticDemo("kk");
  const rows = [
    { ...row, grade: 7 },
    { ...row, id: randomUUID(), topic: " ", goals: "8.1.1.1", grade: null },
  ];
  expect(planIssues(rows, null)).toEqual([
    { id: rows[1].id, index: 1, fields: ["topic", "goals", "grade"] },
  ]);
  expect(canConfirmPlan(rows, 7)).toBe(false);
  expect(canConfirmPlan([], 7)).toBe(false);
});

it("requires explicit assessment skipping for Kazakhstan summative assessment rows", () => {
  const { row } = syntheticDemo("kk");
  for (const topic of ["БЖБ №1", "ТЖБ", "СОР за раздел", "СОЧ"]) {
    const assessment = { ...row, topic, goals: "", goalsSkipped: true };
    expect(canConfirmPlan([assessment], 7)).toBe(true);
    expect(canConfirmPlan([{ ...assessment, goalsSkipped: false }], 7)).toBe(
      false,
    );
  }
  expect(canConfirmPlan([{ ...row, goals: "", goalsSkipped: true }], 7)).toBe(
    false,
  );
});

it("normalizes actual text without mutating source provenance or allowing forged dates and stale warnings", () => {
  const { row } = syntheticDemo("ru");
  const input = {
    ...row,
    sourceOrder: 900,
    dateRaw: "01.09.2026–2026-09-03",
    dateStart: "2030-01-01",
    goals: "7.1.2.1 Описывать алгоритмы",
    goalsSkipped: true,
    warnings: [
      "ocr_requires_review",
      "missing_date",
      "objective_code_only",
      "ocr_requires_review",
    ],
  };
  const copy = structuredClone(input);
  const result = normalizePlanRows([input])[0];
  expect(result).toMatchObject({
    sourceOrder: 1,
    dateStart: "2026-09-01",
    dateEnd: "2026-09-03",
    goalsSkipped: false,
    objectiveCodes: ["7.1.2.1"],
    warnings: ["ocr_requires_review"],
  });
  expect(result.source).toEqual(input.source);
  expect(input).toEqual(copy);
});
