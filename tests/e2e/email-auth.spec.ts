import { test, expect } from "@playwright/test";
import { origin } from "./helpers";

for (const path of ["/login", "/signup", "/lite/"]) {
  test(`email authentication is available without provider buttons: ${path}`, async ({
    page,
    request,
  }) => {
    const config = await (await request.get("/api/public-config")).json();
    expect(config).not.toHaveProperty("socialProviders");
    for (const locale of ["ru", "kk"]) {
      await page
        .context()
        .addCookies([{ name: "ziyatai-locale", value: locale, url: origin }]);
      await page.goto(path);
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Google|Apple/i }),
      ).toHaveCount(0);
      await expect(
        page.locator(
          'input[autocomplete="current-password"], input[autocomplete="new-password"]',
        ),
      ).toBeVisible();
    }
  });
}
