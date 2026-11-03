import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { mergeDrafts } from "../packages/domain/merge-drafts";

it("keeps every Lite runtime script valid ES5", () => {
  for (const file of [
    "lite.js",
    "theme.js",
    "drafts.js",
    "draft-merge.js",
    "account-session.js",
    "curriculum.js",
  ])
    expect(
      () =>
        parse(readFileSync(`public/lite/${file}`, "utf8"), { ecmaVersion: 5 }),
      file,
    ).not.toThrow();
});

it("ships the same safe merge algorithm as ES5 without recent object/array APIs", () => {
  execFileSync(process.execPath, ["scripts/build/build-lite.mjs", "--check"], {
    windowsHide: true,
  });
  const code = readFileSync("public/lite/draft-merge.js", "utf8");
  expect(() => parse(code, { ecmaVersion: 5 })).not.toThrow();
  const window: any = {};
  runInNewContext(
    "Object.hasOwn=undefined;Object.fromEntries=undefined;Array.prototype.flatMap=undefined;Set=undefined;Symbol=undefined;" +
      code,
    { window },
  );
  for (const [base, local, remote] of [
    [
      { rows: [{ id: "a", text: "old", goals: "old" }] },
      { rows: [{ id: "a", text: "mine", goals: "old" }] },
      { rows: [{ id: "a", text: "old", goals: "other" }] },
    ],
    [
      { text: "old", value: null },
      { text: "mine" },
      { text: "other", value: "new" },
    ],
    [
      JSON.parse('{"__proto__":{"v":0},"text":"old"}'),
      JSON.parse('{"__proto__":{"v":1},"text":"old"}'),
      JSON.parse('{"__proto__":{"v":0},"text":"new"}'),
    ],
  ]) {
    const expected = mergeDrafts(base, local, remote);
    expect(
      JSON.parse(
        JSON.stringify(window.ZiyatDraftMerge.mergeDrafts(base, local, remote)),
      ),
    ).toEqual(JSON.parse(JSON.stringify(expected)));
    const choices = Object.fromEntries(
      expected.conflicts.map((c) => [c.key, "remote"]),
    );
    expect(
      JSON.stringify(
        window.ZiyatDraftMerge.mergeDrafts(base, local, remote, choices),
      ),
    ).toBe(JSON.stringify(mergeDrafts(base, local, remote, choices as any)));
  }
});
