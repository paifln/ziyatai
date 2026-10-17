import { test, expect, devices, type Page } from "@playwright/test";
import { verifiedUser } from "./helpers";
import { accountIntentHeader } from "../../packages/contracts/account-intent";
async function navigate(page: Page, label: string, touch: boolean) {
  if (
    (page.viewportSize()?.width ?? 1280) < 1024 &&
    !(await page.locator(".sidebar").isVisible())
  ) {
    const menu = page.getByRole("button", {
      name: "Рабочее пространство",
      exact: true,
    });
    if (touch) await menu.tap();
    else await menu.click();
  }
  const link = page.getByRole("button", { name: label, exact: true });
  if (touch) await link.tap();
  else await link.click();
}
for (const screen of ["desktop", "phone", "tablet"] as const) {
  test.describe(screen, () => {
    const touch = screen !== "desktop";
    if (touch) {
      const descriptor =
        devices[screen === "phone" ? "iPhone 13" : "iPad (gen 7)"];
      test.use({
        viewport: descriptor.viewport,
        deviceScaleFactor: descriptor.deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
        // Descriptors retain old OS versions. Exercise the full UI at its
        // supported iOS minimum; old-OS redirects are tested separately.
        userAgent: descriptor.userAgent.replace(
          /(CPU(?: iPhone)? OS )[\d_]+/,
          (_, prefix: string) => `${prefix}16_4`,
        ),
      });
    }
    test("teacher UI imports a file, confirms rows, edits a task and downloads an export", async ({
      page,
      request,
    }) => {
      await verifiedUser(request);
      const owner = (await (await request.get("/api/auth/get-session")).json())
        .user.id;
      const unscopedRequests: string[] = [];
      page.on("request", (sent) => {
        const url = new URL(sent.url());
        if (
          url.origin === "http://localhost:3000" &&
          url.pathname.startsWith("/api/") &&
          !["/api/auth/", "/api/public-config", "/api/health"].some((path) =>
            url.pathname.startsWith(path),
          ) &&
          ["fetch", "xhr"].includes(sent.resourceType()) &&
          sent.headers()[accountIntentHeader.toLowerCase()] !== owner
        )
          unscopedRequests.push(`${sent.method()} ${url.pathname}`);
      });
      await page.context().addCookies((await request.storageState()).cookies);
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
      await page.goto("/");
      await page.getByRole("button", { name: "РУС", exact: true }).click();
      if (touch) {
        await page.evaluate(() =>
          document.addEventListener(
            "touchstart",
            () => {
              document.documentElement.dataset.qaTouchObserved = "true";
            },
            { once: true },
          ),
        );
        expect(await page.evaluate(() => innerWidth)).toBe(
          page.viewportSize()!.width,
        );
      }
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
      await expect(
        page.getByLabel("Тема урока 1", { exact: true }),
      ).toBeVisible({
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
      await expect(
        page.getByText("Подтверждено", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await navigate(page, "Мои КТП", touch);
      if (touch)
        await expect(page.locator("html")).toHaveAttribute(
          "data-qa-touch-observed",
          "true",
        );
      await page
        .getByRole("button", { name: "Посмотреть пример заданий", exact: true })
        .click();
      await expect(
        page.getByText("Готовый пример • AI не используется", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Редактировать", exact: true })
        .click();
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
      await page
        .getByLabel("Я проверил(а) задания, ответы и критерии", { exact: true })
        .check();
      await page
        .getByRole("button", { name: "Одобрить задания", exact: true })
        .click();
      await expect(
        page.getByText("Одобрено учителем", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "DOCX", exact: true }).click();
      const link = page.getByRole("link", { name: "Скачать", exact: true });
      await expect(link).toBeVisible({ timeout: 30000 });
      const downloadEvent = page.waitForEvent("download");
      await link.click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toContain(".docx");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/qa/editor-${screen === "desktop" ? "1440" : screen}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await navigate(page, "Библиотека", touch);
      await expect(
        page.getByText("Линейные алгоритмы", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.unrouteAll({ behavior: "wait" });
      expect(unscopedRequests).toEqual([]);
    });
  });
}
