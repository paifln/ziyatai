import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { hasGoalText, isAssessmentTopic } from "../packages/domain/goals";

it.each([true, false])(
  "Lite shares Kazakhstan goal rules with the server (Unicode regex support: %s)",
  (unicode) => {
    const root: any = {};
    const context: any = { window: root };
    if (!unicode)
      context.RegExp = function (source: string, flags?: string) {
        if (flags?.includes("u"))
          throw new SyntaxError("Unsupported Unicode flag");
        return new RegExp(source, flags);
      };
    runInNewContext(readFileSync("public/lite/curriculum.js", "utf8"), context);
    for (const text of [
      "СОР №1",
      "БЖБ",
      "ТЖБ",
      "СОЧ",
      "ҚБЖБ",
      "БЖБҚ",
      "Оқу мақсаттары",
      "ТЖБ123",
      "СОРТИРОВКА",
    ])
      expect(root.ZiyatCurriculum.isAssessmentTopic(text), text).toBe(
        isAssessmentTopic(text),
      );
    for (const text of [
      "7.3.2.1",
      "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
      "Описывать алгоритм",
      "",
      "№ 7.1.2.1 —",
    ])
      expect(root.ZiyatCurriculum.hasGoalText(text), text).toBe(
        hasGoalText(text),
      );
  },
);
