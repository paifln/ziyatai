import { test, expect } from "@playwright/test";
import { verifiedUser } from "./helpers";
test("teacher UI imports a file, confirms rows, edits a task and downloads an export", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.route("**/api/profile",async(route)=>{
    const response=await route.fetch();const data=await response.json();
    await route.fulfill({response,json:{...data,capabilities:{...data.capabilities,directUploads:true}}});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByRole("button", { name: "Загрузить КТП", exact: true })
    .first()
    .click();
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/ru-table-1.docx");
  await page
    .getByRole("button", { name: "Извлечь строки", exact: true })
    .click();
  await expect(page.getByLabel("Тема урока 1", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("Класс", { exact: true }).selectOption("7");
  await page.getByLabel("Учебный год", { exact: true }).fill("2026–2027");
  await page
    .getByLabel("Тема урока 1", { exact: true })
    .fill("Линейные алгоритмы — UI проверка");
  await page
    .getByRole("button", { name: "Подтвердить КТП", exact: true })
    .click();
  await expect(page.getByText("Подтверждено", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Обзор", exact: true }).click();
  await page
    .getByRole("button", { name: "Посмотреть пример заданий", exact: true })
    .click();
  await expect(
    page.getByText("Готовый пример • AI не используется", { exact: true }),
  ).toBeVisible();
  const first = page.locator(".task-card").first();
  await first
    .getByLabel("Текст", { exact: true })
    .first()
    .fill("UI проверка: дано число 2. Прибавьте 3.");
  await page
    .getByRole("button", { name: "Сохранить", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Изменения сохранены", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "DOCX", exact: true }).click();
  const link = page.getByRole("link", { name: "Скачать", exact: true });
  await expect(link).toBeVisible({ timeout: 30000 });
  const downloadEvent = page.waitForEvent("download");
  await link.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain(".docx");
  await page.screenshot({
    path: ".local/qa/editor-1440.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await expect(
    page.getByText("Линейные алгоритмы", { exact: true }),
  ).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
});
