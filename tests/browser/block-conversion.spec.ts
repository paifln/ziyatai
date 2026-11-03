import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("switching a filled block preserves text and undo cannot overwrite subsequent edits", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{BlocksEditor}from'./apps/web/components/generations/BlocksEditor';import{dictionary}from'./apps/web/lib/i18n';
    function App(){const[blocks,setBlocks]=useState([{type:'table',text:'',items:[],columns:['A','B'],rows:[['1','2'],['3','4']],language:''}]);return <BlocksEditor blocks={blocks} onChange={setBlocks} t={dictionary.ru}/>}
    createRoot(document.getElementById('root')).render(<App/>);`,
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
  const type = page.getByRole("combobox", { name: "Тип заданий", exact: true });
  await type.selectOption("paragraph");
  await expect(
    page.getByRole("textbox", { name: "Текст", exact: true }),
  ).toHaveValue("A\tB\n1\t2\n3\t4");
  await page
    .getByRole("button", { name: "Отменить смену типа", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Строка 2, Столбец 2", exact: true }),
  ).toHaveValue("4");
  await type.selectOption("paragraph");
  await page
    .getByRole("textbox", { name: "Текст", exact: true })
    .fill("Новая тема\nСледующая строка");
  await expect(
    page.getByRole("button", { name: "Отменить смену типа", exact: true }),
  ).toHaveCount(0);
  await type.selectOption("table");
  await expect(
    page.getByRole("textbox", { name: "Строка 1, Столбец 1", exact: true }),
  ).toHaveValue("Новая тема");
  await expect(
    page.getByRole("textbox", { name: "Строка 2, Столбец 1", exact: true }),
  ).toHaveValue("Следующая строка");
  await type.selectOption("paragraph");
  const text = page.getByRole("textbox", { name: "Текст", exact: true });
  await text.fill("x".repeat(2001));
  await type.selectOption("table");
  await expect(type).toHaveValue("paragraph");
  await expect(page.getByRole("alert")).toContainText("2000 символов");
  await expect(text).toHaveValue("x".repeat(2001));
});
