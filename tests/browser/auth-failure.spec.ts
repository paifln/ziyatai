import { test, expect } from "@playwright/test";
import { build } from "esbuild";
test("an auth outage preserves details, explains the outage and suppresses duplicate submits", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';import AuthPanel from'./apps/web/components/AuthPanel';import{dictionary}from'./apps/web/lib/i18n';createRoot(document.getElementById('root')).render(<AuthPanel t={dictionary.ru} locale="ru" setLocale={()=>{}} initialMode="signup"/>);`,
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
  const origin = "http://localhost:3199";
  let submissions = 0;
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/sign-up/email") {
      submissions++;
      await blocked;
      return route.fulfill({ status: 503, json: { code: "AUTH_UNAVAILABLE" } });
    }
    if (path === "/api/public-config")
      return route.fulfill({ json: { passwordResetAvailable: false } });
    return route.fulfill({
      contentType: "text/html",
      body: '<html lang="ru"><head><title>Auth</title></head><body><div id="root"></div></body></html>',
    });
  });
  await page.goto(origin + "/signup");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.locator('input[autocomplete="name"]').fill("Audit Teacher");
  await page.getByRole("combobox").selectOption("mathematics");
  await page.locator('input[type="email"]').fill("audit@example.test");
  await page.locator('input[type="password"]').fill("synthetic-password-123");
  await page.getByRole("checkbox").check();
  const submit = page.locator("form button.primary");
  await submit.click();
  await expect(submit).toBeDisabled();
  await page
    .locator("form")
    .evaluate((form) => (form as HTMLFormElement).requestSubmit());
  release!();
  await expect(page.getByRole("alert").first()).toContainText(
    "временно недоступен",
  );
  expect(submissions).toBe(1);
  await expect(page.locator('input[type="email"]')).toHaveValue(
    "audit@example.test",
  );
  await expect(page.locator('input[type="password"]')).toHaveValue(
    "synthetic-password-123",
  );
  await expect(submit).toBeEnabled();
});
