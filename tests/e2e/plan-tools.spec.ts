import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { headers, origin, verifiedUser } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

test("an upcoming lesson beyond the first page opens its actual row without losing any lessons", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = Array.from({ length: 40 }, (_, i) => ({
    ...plan.rows[0],
    id: randomUUID(),
    grade: i % 2 ? 10 : 2,
    sourceOrder: i + 1,
    topic: i === 27 ? "Ближайший урок за первой страницей" : `Урок ${i + 1}`,
    dateRaw: i === 27 ? "28.10.2026" : i === 0 ? "27.10.2026" : "",
  }));
  expect(
    (
      await request.patch(`/api/ktp/${plan.id}/rows`, {
        headers,
        data: {
          revision: plan.revision,
          rows,
          grade: null,
          schoolYear: "2026–2027",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.clock.install({ time: new Date("2026-10-28T06:00:00Z") });
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: origin }]);
  await page.goto("/");
  await page.locator(".resource-open").click();
  await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .selectOption("10");
  await page.locator(".plan-schedule > summary").click();
  await page
    .getByRole("button", { name: /Ближайший урок за первой страницей/ })
    .click();
  await expect(page.getByLabel("Тема урока 28", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Показать класс", exact: true }),
  ).toHaveValue("");
  expect(
    (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows,
  ).toHaveLength(40);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".plan-schedule")).toBeHidden();
});

test("CSV includes unsaved edits and filtered-out rows while leaving the saved plan unchanged", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = [2, 10, 2].map((grade, i) => ({
    ...plan.rows[0],
    id: randomUUID(),
    grade,
    sourceOrder: i + 1,
    topic: `Сохранённая тема ${i + 1}`,
  }));
  expect(
    (
      await request.patch(`/api/ktp/${plan.id}/rows`, {
        headers,
        data: {
          revision: plan.revision,
          rows,
          grade: null,
          schoolYear: "2026–2027",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: origin }]);
  await page.goto("/");
  await page.locator(".resource-open").click();
  await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .selectOption("2");
  await page
    .getByLabel("Тема урока 1", { exact: true })
    .fill("Несохранённая тема для CSV");
  await page.setViewportSize({ width: 360, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать весь КТП (CSV)", exact: true })
    .click();
  const download = await waiting;
  const path = test.info().outputPath("all-rows.csv");
  await download.saveAs(path);
  const text = await readFile(path, "utf8");
  expect(text).toContain("Несохранённая тема для CSV");
  expect(text).toContain("Сохранённая тема 2");
  const saved = await (await request.get(`/api/ktp/${plan.id}`)).json();
  expect(saved.rows[0].topic).toBe("Сохранённая тема 1");
  expect(saved.rows).toHaveLength(3);
  await expect(
    page.getByText("Есть несохранённые изменения", { exact: true }),
  ).toBeVisible();
});
