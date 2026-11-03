import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { stylesheet } from "./styles";

for (const locale of ["ru", "kk"] as const) {
  test(`Supabase password signup preserves details and opens the workspace immediately on mobile (${locale})`, async ({
    page,
  }) => {
    const origin = "http://localhost:3199";
    const requests: { path: string; body: Record<string, string> }[] = [];
    const bundle = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
          import AuthPanel from './apps/web/components/AuthPanel';
          import { dictionary } from './apps/web/lib/i18n';
          createRoot(document.getElementById('root')).render(<AuthPanel t={dictionary.${locale}} locale="${locale}" initialMode="signup" setLocale={() => {}} />);`,
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
    await page.setViewportSize({ width: 320, height: 800 });
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/public-config")
        return route.fulfill({ json: { authProvider: "supabase" } });
      if (path.startsWith("/api/auth/")) {
        requests.push({ path, body: route.request().postDataJSON() });
        return route.fulfill({ json: { success: true } });
      }
      if (path === "/" || path === "/signup")
        return route.fulfill({
          contentType: "text/html",
          body: `<html lang="${locale}"><head><title>Email code</title></head><body><div id="root"></div></body></html>`,
        });
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${origin}/signup`);
    for (const file of ["app/globals.css", "app/theme.css", "app/landing.css"])
      await page.addStyleTag({ content: await stylesheet(file) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
      [320, 800],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() =>
          page.evaluate(() => ({
            horizontal: document.documentElement.scrollWidth > innerWidth + 1,
            vertical: document.documentElement.scrollHeight > innerHeight + 1,
          })),
        )
        .toEqual({ horizontal: false, vertical: false });
    }
    await page.locator('input[autocomplete="name"]').fill("Әлия Ғалымқызы");
    await page.getByRole("combobox").selectOption("mathematics");
    await page.locator('input[type="email"]').fill("teacher@example.test");
    await page.getByRole("checkbox").check();
    await page.locator('input[type="password"]').fill("synthetic-password-123");
    await page
      .getByRole("button", {
        name: locale === "ru" ? "Создать аккаунт" : "Аккаунт құру",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(`${origin}/`);
    expect(requests[0]).toEqual({
      path: "/api/auth/sign-up/email",
      body: {
        email: "teacher@example.test",
        password: "synthetic-password-123",
        name: "Әлия Ғалымқызы",
        teachingSubject: "mathematics",
      },
    });
    await expect(
      page.locator('input[autocomplete="one-time-code"]'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
