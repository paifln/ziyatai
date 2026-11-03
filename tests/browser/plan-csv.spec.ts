import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { syntheticDemo } from "../../packages/domain/demo";

test("all plan rows download in a local UTF-8 CSV while offline without a server request", async ({
  page,
  context,
}) => {
  const row = syntheticDemo("ru").row;
  const rows = [
    { ...row, id: "first", grade: 2, topic: "Несохранённая тема" },
    { ...row, id: "hidden", grade: 10, topic: "Скрытая строка" },
    { ...row, id: "formula", grade: 2, topic: "=1+1" },
  ];
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {DownloadPlanCsv} from './apps/web/components/plans/DownloadPlanCsv';
      createRoot(document.getElementById('root')).render(<DownloadPlanCsv rows={${JSON.stringify(rows)}} grade={null} locale="ru" disabled={false}/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  let requests = 0;
  page.on("request", () => requests++);
  await context.setOffline(true);
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать весь КТП (CSV)", exact: true })
    .click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("ZiyatAI-KTP.csv");
  const path = test.info().outputPath("plan.csv");
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
  const text = bytes.toString("utf8");
  expect(text).toContain("Несохранённая тема");
  expect(text).toContain("Скрытая строка");
  expect(text).toContain('"\'=1+1"');
  expect(requests).toBe(0);
});
