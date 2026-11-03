import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("connection notice follows browser connectivity and preserves the open form", async ({
  page,
  context,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ConnectionNotice} from './apps/web/components/ui/ConnectionNotice';
      createRoot(document.getElementById('root')).render(<><ConnectionNotice locale="ru"/><input aria-label="Правки" defaultValue=""/></>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const form = page.getByRole("textbox", { name: "Правки" });
  await form.fill("Несохранённая тема");
  await expect(page.locator(".connection-notice")).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.locator(".connection-notice")).toContainText(
    "повторите сохранение",
  );
  await expect(form).toHaveValue("Несохранённая тема");
  await context.setOffline(false);
  await expect(page.locator(".connection-notice")).toHaveCount(0);
  await expect(form).toHaveValue("Несохранённая тема");
});
