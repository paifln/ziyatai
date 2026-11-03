import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { browserStyles } from "./styles";
import AxeBuilder from "@axe-core/playwright";

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
      if (path === "/fonts/onest.woff2")
        return route.fulfill({
          contentType: "font/woff2",
          body: await readFile("public/fonts/onest.woff2"),
        });
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
    for (const file of [
      "app/globals.css",
      "app/theme.css",
      "app/landing.css",
    ]) {
      const content = await browserStyles(file);
      await page.addStyleTag({ content });
    }
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of [
      [1366, 640],
      [1366, 768],
      [390, 844],
      [320, 800],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
        )
        .toBe(false);
      // Vertical scrolling is necessary at short heights and browser zoom; do not
      // shrink touch targets or clip controls to force the whole page above the fold.
      for (const control of await page
        .locator(
          'form input:not([type="checkbox"]),form select,.password-toggle,.language-switch button',
        )
        .all()) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator("form button.primary").scrollIntoViewIfNeeded();
      await expect(page.locator("form button.primary")).toBeInViewport();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
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
