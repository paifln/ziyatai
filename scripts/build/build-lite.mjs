import { readFile, readdir, writeFile } from "node:fs/promises";
import ts from "typescript";
import { format } from "prettier";
import { parse } from "acorn";

// These ordered fragments share one ES5 closure. No module loader or new browser API.
const parts = JSON.parse(await readFile("apps/lite/parts.json", "utf8"));
if (
  !Array.isArray(parts) ||
  !parts.length ||
  new Set(parts).size !== parts.length
)
  throw new Error("Invalid Lite source manifest");
const sources = (await readdir("apps/lite")).filter((name) =>
  name.endsWith(".part.js"),
);
if (
  sources.length !== parts.length ||
  sources.some((name) => !parts.includes(name))
)
  throw new Error("Lite source manifest does not include every fragment");
const fragments = [];
for (const part of parts) {
  if (typeof part !== "string" || !/^[a-z-]+\.part\.js$/.test(part))
    throw new Error("Invalid Lite source path");
  fragments.push(await readFile(`apps/lite/${part}`, "utf8"));
}
const liteOutput = `/* Generated from apps/lite/parts.json by npm run build:lite.
 * ES5 syntax; ordered fragments share one private closure.
 */
(function () {
${fragments.join("")}})();
`;
parse(liteOutput, { ecmaVersion: 5 });
if (process.argv.includes("--check")) {
  if ((await readFile("public/lite/lite.js", "utf8")) !== liteOutput)
    throw new Error("Lite application is stale. Run npm run build:lite.");
} else await writeFile("public/lite/lite.js", liteOutput);

const input = await readFile("packages/domain/merge-drafts.ts", "utf8");
const compiled = ts
  .transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      removeComments: true,
    },
  })
  .outputText.replace(/^\s*"use strict";\s*/, "");
const payload = ts
  .transpileModule(await readFile("packages/domain/draft-payload.ts", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      removeComments: true,
    },
  })
  .outputText.replace(/^\s*"use strict";\s*/, "");
const output = await format(
  `/* Generated from packages/domain/merge-drafts.ts and draft-payload.ts by npm run build:lite. */\n(function(root) { "use strict"; var exports = {};\n${compiled}\nroot.ZiyatDraftMerge = exports;\n})(window);\n(function(root) { "use strict"; var exports = {}; function require(name) { if (name === "./merge-drafts") return root.ZiyatDraftMerge; throw new Error("Unsupported Lite dependency"); }\n${payload}\nroot.ZiyatDraftPayload = exports;\n})(window);\n`,
  { parser: "babel", trailingComma: "es5" },
);
const path = "public/lite/draft-merge.js";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8").catch(() => "")) !== output)
    throw new Error("Lite merge is stale. Run npm run build:lite.");
} else await writeFile(path, output);

const curriculum = ts.transpileModule(
  await readFile("packages/domain/goals.ts", "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      removeComments: true,
    },
  },
).outputText;
const curriculumOutput = await format(
  `/* Generated from packages/domain/goals.ts by npm run build:lite. */\n(function(root) { "use strict"; var exports = {};\n${curriculum}\nroot.ZiyatCurriculum = exports;\n})(window);\n`,
  { parser: "babel", trailingComma: "es5" },
);
const curriculumPath = "public/lite/curriculum.js";
if (process.argv.includes("--check")) {
  if (
    (await readFile(curriculumPath, "utf8").catch(() => "")) !==
    curriculumOutput
  )
    throw new Error("Lite curriculum is stale. Run npm run build:lite.");
} else await writeFile(curriculumPath, curriculumOutput);
