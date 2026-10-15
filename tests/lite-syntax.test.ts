import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { expect, it } from "vitest";
import { browserSupportScript } from "../packages/domain/browser-support";
it("keeps the pre-hydration fallback and lite interface parseable as ES5", () => {
  expect(() => parse(browserSupportScript, { ecmaVersion: 5 })).not.toThrow();
  expect(() =>
    parse(readFileSync("public/lite/lite.js", "utf8"), { ecmaVersion: 5 }),
  ).not.toThrow();
});
