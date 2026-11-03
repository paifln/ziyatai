import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("English source language is submitted when importing a KTP", async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("https://upload.example.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/uploads")
      return route.fulfill({ json: { id: "synthetic-upload" } });
    if (path === "/api/ktp/imports") {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { id: "synthetic-plan" } });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<html lang="ru"><body><div id="root"></div></body></html>',
    });
  });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import { UploadPanel } from './apps/web/components/forms/UploadPanel';
        import { AccountClientProvider } from './apps/web/lib/account-client';
        import { dictionary } from './apps/web/lib/i18n';
        createRoot(document.getElementById('root')).render(
          <AccountClientProvider owner="teacher" onSessionChanged={()=>{}}>
            <UploadPanel directUploads={false} locale="ru" t={dictionary.ru}
              onDone={(id)=>document.body.dataset.imported=id}
              onError={(error)=>document.body.dataset.error=error} onCancel={()=>{}} />
          </AccountClientProvider>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.goto("https://upload.example.test");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByLabel("Язык исходного КТП").selectOption("en");
  await page.locator('input[type="file"]').setInputFiles({
    name: "English-plan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-synthetic"),
  });
  await page.locator(".upload-actions button.primary").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-imported",
    "synthetic-plan",
  );
  expect(submitted).toMatchObject({
    locale: "en",
    uploadId: "synthetic-upload",
  });
});
