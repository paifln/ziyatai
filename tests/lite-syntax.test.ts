import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { expect, it } from "vitest";
import { browserSupportScript } from "../packages/domain/browser-support";
import { themeScript } from "../packages/domain/theme";
it("keeps the pre-hydration fallback and lite interface parseable as ES5", () => {
  expect(() => parse(browserSupportScript, { ecmaVersion: 5 })).not.toThrow();
  expect(() => parse(themeScript, { ecmaVersion: 5 })).not.toThrow();
  expect(() =>
    parse(readFileSync("public/lite/theme.js", "utf8"), { ecmaVersion: 5 }),
  ).not.toThrow();
  expect(() =>
    parse(readFileSync("public/lite/lite.js", "utf8"), { ecmaVersion: 5 }),
  ).not.toThrow();
});
