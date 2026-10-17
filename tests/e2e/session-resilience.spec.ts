import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifiedUser } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
test("a school IP can check more than thirty valid sessions per minute", async ({
  request,
}) => {
  await verifiedUser(request);
  for (let i = 0; i < 40; i++) {
    const response = await request.get("/api/auth/get-session");
    expect(response.status()).toBe(200);
    expect((await response.json()).user).toBeTruthy();
  }
});

for (const status of [429, 503]) {
  test(`session lookup ${status} shows a retry action and recovers without a false guest page`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    await page.context().addCookies((await request.storageState()).cookies);
    await page
      .context()
      .addCookies([
        { name: "ziyatai-locale", value: "ru", domain: "localhost", path: "/" },
      ]);
    await page.route(
      "**/api/auth/get-session",
      (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Synthetic temporary session failure",
          }),
        }),
      { times: 1 },
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Не удалось проверить вход",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Войти", exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    if (status === 503)
      await page.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "dark"),
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".session-retry").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `.local/qa/session-retry-${status}.png` });
    await page
      .getByRole("button", { name: "Повторить проверку", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Мои КТП", exact: true }),
    ).toBeVisible();
  });
}
