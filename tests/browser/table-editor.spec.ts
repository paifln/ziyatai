import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("table paste grows a range and duplication opens the correct page", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import TableEditor from './apps/web/components/TableEditor';
        import { dictionary } from './apps/web/lib/i18n';
        function App() {
          const [block, setBlock] = useState({ columns: ['A', 'B'], rows: Array.from({length: 10}, (_, i) => [String(i + 1), '']) });
          return <><TableEditor block={block} t={dictionary.ru} onChange={change => setBlock(current => ({...current, ...change}))} /><pre id="state">{JSON.stringify(block)}</pre></>;
        }
        createRoot(document.getElementById('root')).render(<App />);`,
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
  const paste = async (label: string, text: string) => {
    await page
      .getByRole("textbox", { name: label, exact: true })
      .evaluate((input, value) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", value);
        input.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, text);
  };
  await paste("Строка 10, Столбец 2", "x\ty\r\nz\tw\r\n");
  await expect(page.getByRole("status")).toHaveText("Диапазон вставлен: 2 × 2");
  await expect(
    page.getByRole("textbox", { name: "Строка 10, Столбец 3", exact: true }),
  ).toHaveValue("y");
  await page
    .getByRole("button", { name: "Отменить вставку", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 10, Столбец 2", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "Столбец 3", exact: true }),
  ).toHaveCount(0);
  await paste("Строка 10, Столбец 2", "x\ty\r\nz\tw\r\n");
  await page
    .getByRole("button", { name: "Дублировать строку 10", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 11, Столбец 2", exact: true }),
  ).toHaveValue("x");
  await paste("Строка 11, Столбец 2", '"line one\nline two"\tfinish');
  const multiline = page.getByRole("textbox", {
    name: "Строка 11, Столбец 2",
    exact: true,
  });
  await expect(multiline).toHaveValue("line one\nline two");
  await multiline.fill("edited\nvalue");
  expect(
    JSON.parse((await page.locator("#state").textContent())!).rows[10][1],
  ).toBe("edited\nvalue");
  await expect(
    page.getByRole("textbox", { name: "Строка 12, Столбец 2", exact: true }),
  ).toHaveValue("z");
  // A later edit invalidates undo so it cannot overwrite more recent changes.
  await expect(
    page.getByRole("button", { name: "Отменить вставку", exact: true }),
  ).toHaveCount(0);
  const before = await page.locator("#state").textContent();
  await paste("Строка 11, Столбец 2", Array(21).fill("x").join("\t"));
  await expect(page.getByRole("alert")).toContainText("Данные не изменены");
  await expect(page.locator("#state")).toHaveText(before!);
  await page
    .getByRole("button", { name: "Удалить строку 11", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 11, Столбец 2", exact: true }),
  ).toHaveValue("z");
  await page
    .getByRole("button", { name: "Отменить изменение таблицы", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 11, Столбец 2", exact: true }),
  ).toHaveValue("edited\nvalue");
  await page
    .getByRole("button", { name: "Удалить столбец 2", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 11, Столбец 2", exact: true }),
  ).toHaveValue("finish");
  await page
    .getByRole("button", { name: "Отменить изменение таблицы", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 11, Столбец 2", exact: true }),
  ).toHaveValue("edited\nvalue");
});
