import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { format } from "prettier";

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
const output = await format(
  `/* Generated from packages/domain/merge-drafts.ts by npm run build:lite. */\n(function(root) { "use strict"; var exports = {};\n${compiled}\nroot.ZiyatDraftMerge = exports;\n})(window);\n`,
  { parser: "babel", trailingComma: "es5" },
);
const path = "public/lite/draft-merge.js";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8").catch(() => "")) !== output)
    throw new Error("Lite merge is stale. Run npm run build:lite.");
} else await writeFile(path, output);
