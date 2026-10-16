import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

async function readable(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test("dark preference carries through sign-in, registration, Lite, help and legal pages", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByRole("button", { name: "Включить тёмную тему", exact: true })
    .click();
  for (const path of [
    "/login",
    "/signup",
    "/lite/",
    "/help/",
    "/privacy",
    "/terms",
    "/cookies",
  ]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (["/login", "/signup", "/lite/"].includes(path))
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await readable(page);
    }
  }
});

test("teacher review opens answers, focuses editing and keeps a readable dark layout", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/?generation=${demo.id}`);
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByRole("button", { name: "Включить тёмную тему", exact: true })
    .click();
  const first = page.locator(".task-review-card").first();
  await expect(page.locator(".task-review-card")).toHaveCount(9);
  await expect(first.locator(".review-answer-content")).toHaveCount(0);
  await first.locator("summary").click();
  await expect(first.locator(".review-answer-content")).toBeVisible();
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await readable(page);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Доработать задание 1", exact: true })
    .click();
  const text = page
    .locator(".task-card")
    .first()
    .getByLabel("Текст", { exact: true })
    .first();
  await expect(text).toBeFocused();
  await text.fill(
    "К числу 2 прибавьте 3. Покажите решение и объясните свой ответ.",
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Изменения сохранены", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Проверка", exact: true }).click();
  await expect(first).toContainText("объясните свой ответ");
  await expect(
    page.getByRole("button", { name: "Одобрить задания", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Макет", exact: true }).click();
  await expect(page.locator(".preview-paper")).toBeVisible();
  await readable(page);
});
