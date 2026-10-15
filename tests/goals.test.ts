import { expect, it } from "vitest";
import { hasGoalText } from "../packages/domain/goals";
it("requires a description beyond codes, punctuation and separators", () => {
  for (const goal of [
    "7.3.2.1:",
    "(7.3.2.1) / 7.3.2.2",
    "№ 7.3.2.1 —",
    "...",
    "💡",
    "",
  ])
    expect(hasGoalText(goal)).toBe(false);
  expect(hasGoalText("7.3.2.1 Әрекеттер тізбегін құру")).toBe(true);
  expect(hasGoalText("Составлять линейные алгоритмы")).toBe(true);
});
