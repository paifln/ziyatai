import { it, expect } from "vitest";
import { syntheticDemo } from "../packages/domain/demo";
import { planCsv } from "../packages/domain/plan-csv";

it("exports every row in source order with explicit classes, skips and a UTF-8 BOM", () => {
  const row = syntheticDemo("kk").row;
  const rows = [
    {
      ...row,
      grade: 2,
      topic: 'Қазақша; "мәтін"\nекінші жол',
      dateRaw: "28.10.2026",
      dateSkipped: true,
    },
    {
      ...row,
      grade: null,
      goalsSkipped: true,
      source: { ...row.source, sheet: "10А" },
    },
  ];
  const before = structuredClone(rows);
  const output = planCsv(rows, 7, "kk");
  expect(output.startsWith('\uFEFF"№";"Сабақ нөмірі"')).toBe(true);
  expect(output).toContain('"Қазақша; ""мәтін""\nекінші жол"');
  expect(output).not.toContain("28.10.2026");
  expect(output).toContain(';"2";');
  expect(output).toContain(';"10";');
  expect(output).toContain('"Иә";"Жоқ"');
  expect(output).toContain('"Жоқ";"Иә"');
  expect(rows).toEqual(before);
});

it("neutralizes formulas even after leading whitespace while retaining quoted data", () => {
  const row = syntheticDemo("ru").row;
  for (const topic of [
    "=SUM(A1)",
    "+cmd",
    "-10+20",
    "@SUM(A1)",
    "  =1+1",
    "\t=1+1",
    "\r=1+1",
  ]) {
    expect(planCsv([{ ...row, topic }], 7, "ru")).toContain(
      "\"'" + topic + '"',
    );
  }
  expect(planCsv([{ ...row, topic: "Обычный текст" }], 7, "ru")).toContain(
    '"Обычный текст"',
  );
  expect(planCsv([], null, "ru").split("\r\n")).toHaveLength(2);
});
