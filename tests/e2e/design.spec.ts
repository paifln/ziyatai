import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifiedUser } from "./helpers";

test("older-browser user agents reach Lite before depending on React", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 Chrome/109.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3000/");
  await expect(page).toHaveURL(/\/lite\/?$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("idle workspace does not poll business APIs and auth responses forbid shared caching", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const session = await request.get("/api/auth/get-session");
  expect(session.headers()["cache-control"]).toContain("no-store");
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Келесі сабаққа қажеттінің бәрі" }),
  ).toBeVisible();
  let requests = 0;
  page.on("request", (r) => {
    if (/\/api\/(?:profile|ktp|library|jobs)(?:\?|$)/.test(r.url())) requests++;
  });
  await page.clock.install();
  await page.clock.fastForward(120000);
  expect(requests).toBe(0);
  const updated = page.waitForResponse((r) => r.url().endsWith("/api/profile"));
  await page
    .getByRole("button", { name: "Деректерді жаңарту", exact: true })
    .click();
  await updated;
  expect(requests).toBe(4);
});

test("both sign-in experiences are accessible and fit phones, tablets and desktops", async ({
  page,
}) => {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/lite/"]) {
      await page.goto(path);
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: `.local/qa/redesign-${path === "/" ? "auth" : "lite"}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});

test("workspace stays readable on small screens and protects unsaved edits", async ({
  page,
  request,
}) => {
  await verifiedUser(request, "Алия Мұғалім");
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Всё для следующего урока" }),
  ).toBeVisible();
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: ".local/qa/redesign-dashboard-1440.png",
    fullPage: true,
  });
  for (const width of [768, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page
      .getByRole("button", { name: "Рабочее пространство", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Мои КТП", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar")).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      "hidden",
    );
    await page.screenshot({
      path: `.local/qa/redesign-dashboard-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Посмотреть пример заданий", exact: true })
    .click();
  await page
    .locator(".task-card")
    .first()
    .getByLabel("Текст", { exact: true })
    .first()
    .fill("Не потерять эти изменения");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Обзор", exact: true }).click();
  await expect(
    page
      .locator(".task-card")
      .first()
      .getByLabel("Текст", { exact: true })
      .first(),
  ).toHaveValue("Не потерять эти изменения");
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("lite imports, confirms, paginates and exports without loading React", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  const paths: string[] = [];
  await page.route("**/api/profile", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        capabilities: { ...data.capabilities, directUploads: true },
      },
    });
  });
  page.on("request", (r) => paths.push(r.url()));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/lite/");
  await page.getByRole("button", { name: "Русский", exact: true }).click();
  await page
    .getByRole("button", { name: "Загрузить КТП", exact: true })
    .click();
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/ru-table-1.docx");
  await page
    .getByRole("button", { name: "Извлечь строки", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Обновить", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        if (await page.getByLabel("Класс", { exact: true }).isVisible())
          return true;
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        return false;
      },
      { timeout: 30000, intervals: [1500] },
    )
    .toBe(true);
  await page.getByLabel("Класс", { exact: true }).selectOption("7");
  await page.getByLabel("Учебный год", { exact: true }).fill("2026–2027");
  await page
    .getByLabel("Тема урока", { exact: true })
    .first()
    .fill("Линейные алгоритмы — lite");
  await page
    .getByRole("button", { name: "Подтвердить КТП", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Создать задания", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Задания", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Синтетический образец (без AI)",
      exact: true,
    })
    .click();
  await expect(page.locator(".task")).toHaveCount(9);
  await page
    .getByRole("button", { name: "Редактировать 1", exact: true })
    .click();
  await page
    .getByLabel("Условие 1", { exact: true })
    .fill("Лёгкий режим: к числу 2 прибавьте 3. Покажите решение.");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".task").first()).toContainText(
    "Лёгкий режим: к числу 2 прибавьте 3.",
  );
  await page
    .getByLabel("Я проверил(а) задания, ответы и критерии", { exact: true })
    .check();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(paths.some((p) => p.includes("/_next/"))).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "DOCX", exact: true }).click();
  await expect
    .poll(
      async () => {
        if (
          await page.getByRole("link", { name: "Скачать", exact: true }).count()
        )
          return true;
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        return false;
      },
      { timeout: 30000, intervals: [1500] },
    )
    .toBe(true);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Скачать", exact: true })
    .first()
    .click();
  const downloaded = await downloadEvent;
  expect(downloaded.suggestedFilename()).toContain(".docx");
  await downloaded.saveAs(".local/qa/reviewed.docx");
  const documents = await (await request.get("/api/library")).json();
  expect(documents[0].teacher_reviewed).toBe(true);
});
