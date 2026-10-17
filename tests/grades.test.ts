import { expect, it } from "vitest";
import { syntheticDemo } from "../packages/domain/demo";
import {
  gradeFromLabel,
  planGrades,
  rowGrade,
} from "../packages/domain/grades";

it("recognises explicit class labels without mistaking curriculum codes for grades", () => {
  for (const [text, grade] of [
    ["7 класс", 7],
    ["Сынып: 10", 10],
    ["8-сынып", 8],
    ["11А", 11],
    ["6 Б", 6],
  ] as const)
    expect(gradeFromLabel(text)).toBe(grade);
  for (const text of [
    "7.1.2.1",
    "2026–2027",
    "Лист 2",
    "12 класс",
    "1-11 классы",
  ])
    expect(gradeFromLabel(text)).toBeNull();
});
it("keeps explicit row grades above plan defaults and sorts class choices numerically", () => {
  const { row } = syntheticDemo("ru");
  const rows = [
    { ...row, grade: 10 },
    { ...row, grade: 2 },
    { ...row, grade: 10 },
  ];
  expect(planGrades(rows, 7)).toEqual([2, 10]);
  expect(rowGrade(rows[0], 7)).toBe(10);
  expect(rowGrade({ ...row, source: { ...row.source, sheet: "11А" } }, 7)).toBe(
    11,
  );
  expect(rowGrade({ ...row, source: { ...row.source, sheet: null } }, 7)).toBe(
    7,
  );
});
