import { test, expect } from "@playwright/test";
import { verifiedUser } from "./helpers";

for (const failure of ["denied", "quota"] as const) {
  test(`workspace remains usable when browser preference storage is ${failure}`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    await page.context().addCookies((await request.storageState()).cookies);
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript((mode) => {
      if (mode === "denied")
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException(
              "Storage blocked by policy",
              "SecurityError",
            );
          },
        });
      else
        Storage.prototype.setItem = function () {
          throw new DOMException("Storage full", "QuotaExceededError");
        };
    }, failure);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Мои КТП", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Свернуть панель", exact: true })
      .click();
    await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
    await page
      .getByRole("button", { name: "Развернуть панель", exact: true })
      .click();
    await expect(page.locator(".sidebar")).not.toHaveClass(/collapsed/);
    await page
      .getByRole("button", { name: "Включить тёмную тему", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // A manual choice in this tab must survive system changes without storage.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Загрузить КТП", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Новый календарный план",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/lite/");
    if ((await page.locator("#language").textContent()) === "Русский")
      await page.locator("#language").click();
    await expect(
      page.getByRole("heading", { name: "Мои КТП", exact: true }),
    ).toBeVisible();
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Загрузить КТП", exact: true })
      .click();
    await expect(page.locator("input[type=file]")).toBeAttached();
    expect(errors).toEqual([]);
  });
}
