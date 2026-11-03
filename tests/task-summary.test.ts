import { expect, it } from "vitest";
import { syntheticDemo } from "../packages/domain/demo";
import { summarizeTasks } from "../packages/domain/task-summary";

it("keeps differentiated workloads separate and includes missing levels", () => {
  const task = syntheticDemo("ru").document.tasks[0];
  const tasks = [
    { ...task, level: "easy" as const, estimatedMinutes: 4, points: 2 },
    { ...task, level: "easy" as const, estimatedMinutes: 6, points: 3 },
    { ...task, level: "advanced" as const, estimatedMinutes: 15, points: 8 },
  ];
  const before = structuredClone(tasks);
  expect(summarizeTasks(tasks)).toEqual([
    { level: "easy", count: 2, minutes: 10, points: 5 },
    { level: "medium", count: 0, minutes: 0, points: 0 },
    { level: "advanced", count: 1, minutes: 15, points: 8 },
  ]);
  expect(tasks).toEqual(before);
});

it("handles an empty document without inventing workload", () => {
  expect(
    summarizeTasks([]).every(
      (group) => group.count === 0 && group.minutes === 0 && group.points === 0,
    ),
  ).toBe(true);
});
