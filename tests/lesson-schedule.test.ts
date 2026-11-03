import { expect, it } from "vitest";
import { syntheticDemo } from "../packages/domain/demo";
import { lessonSchedule, schoolDate } from "../packages/domain/lesson-schedule";

it("uses the Kazakhstan calendar day across UTC midnight boundaries", () => {
  expect(schoolDate(new Date("2026-10-27T18:59:59Z"))).toBe("2026-10-27");
  expect(schoolDate(new Date("2026-10-27T19:00:00Z"))).toBe("2026-10-28");
  expect(schoolDate(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
});

it("finds current ranges and future lessons without inferring missing or invalid dates", () => {
  const row = syntheticDemo("ru").row;
  const rows = [
    { ...row, id: "future", dateRaw: "30.10.2026", dateStart: "2000-01-01" },
    { ...row, id: "past", dateRaw: "27.10.2026" },
    { ...row, id: "range", dateRaw: "26.10.2026–29.10.2026" },
    { ...row, id: "today", dateRaw: "28.10.2026" },
    { ...row, id: "missing-year", dateRaw: "29.10" },
    { ...row, id: "invalid", dateRaw: "31.02.2026" },
    { ...row, id: "skipped", dateRaw: "29.10.2026", dateSkipped: true },
  ];
  const before = structuredClone(rows);
  const schedule = lessonSchedule(rows, "2026-10-28", 2);
  expect(schedule).toMatchObject({
    upcomingCount: 3,
    undated: 3,
    past: 1,
    active: 2,
  });
  expect(schedule.upcoming.map((item) => item.row.id)).toEqual([
    "range",
    "today",
  ]);
  expect(
    lessonSchedule(rows, "2026-10-30").upcoming.map((item) => item.row.id),
  ).toEqual(["future"]);
  expect(rows).toEqual(before);
});

it("keeps equal-date lessons in source order and treats the end date as inclusive", () => {
  const row = syntheticDemo("kk").row;
  const rows = ["a", "b"].map((id) => ({
    ...row,
    id,
    dateRaw: "2026-10-28 — 2026-10-30",
  }));
  expect(
    lessonSchedule(rows, "2026-10-30").upcoming.map((item) => item.row.id),
  ).toEqual(["a", "b"]);
  expect(lessonSchedule(rows, "2026-10-31").past).toBe(2);
  expect(lessonSchedule([], "2026-10-28").upcoming).toEqual([]);
  expect(() => lessonSchedule(rows, "2026-02-31")).toThrow(RangeError);
  expect(() => lessonSchedule(rows, "2026-10-28", 0)).toThrow(RangeError);
});
