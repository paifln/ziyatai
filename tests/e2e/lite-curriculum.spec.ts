import { origin as qaOrigin } from "./helpers";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("Lite only generates from the saved and confirmed curriculum", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await page.route("**/api/profile", async (route) => {
    const response = await route.fetch(),
      profile = await response.json();
    await route.fulfill({
      response,
      json: { ...profile, capabilities: { ...profile.capabilities, ai: true } },
    });
  });
  let reads = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/ktp/${demo.planId}`, async (route) => {
    const response = await route.fetch();
    reads++;
    if (reads === 2) await gate;
    await route.fulfill({ response });
  });
  try {
    await enterLite(page, request);
    await page.getByRole("button", { name: "Открыть", exact: true }).click();
    const create = page.getByRole("button", {
      name: "Создать задания",
      exact: true,
    });
    await expect(create).toBeEnabled();
    await page
      .getByLabel("Тема урока", { exact: true })
      .first()
      .fill("Новая подтверждённая тема Lite");
    await expect(create).toBeDisabled();
    await expect(
      page.getByText("Сначала сохраните изменения и подтвердите КТП.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(() => reads).toBe(2);
    await expect(create).toBeDisabled();
    release();
    await expect(create).toHaveCount(0);
    await page
      .getByRole("button", { name: "Подтвердить КТП", exact: true })
      .click();
    await expect(create).toBeEnabled();
    await create.click();
    await expect(
      page.getByRole("combobox", { name: "Тема урока", exact: true }),
    ).toContainText("Новая подтверждённая тема Lite");
    const canonical = await (
      await request.get(`/api/ktp/${demo.planId}`)
    ).json();
    expect(canonical.status).toBe("confirmed");
    expect(canonical.rows[0].topic).toBe("Новая подтверждённая тема Lite");
  } finally {
    release();
  }
});

test("Lite dark navigation, source and success/error messages have readable contrast", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 360, height: 800 });
  await enterLite(page, request);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await page
    .getByLabel("Тема урока", { exact: true })
    .first()
    .fill("Читаемый тёмный КТП");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("#message")).toHaveText("Сохранено");
  await page.waitForLoadState("networkidle");
  for (const summary of await page.locator("#content details > summary").all())
    await summary.click();
  const audit = () =>
    new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
  expect((await audit()).violations).toEqual([]);
  await page.locator(".skip").focus();
  expect((await audit()).violations).toEqual([]);
  await page.getByRole("button", { name: "Обновить", exact: true }).focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".local/qa/lite-dark-review.png",
    fullPage: true,
  });
  await page.route(`**/api/ktp/${demo.planId}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "INTERNAL" }),
    });
  });
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.locator("#message.error")).toBeVisible();
  expect((await audit()).violations).toEqual([]);
});

async function enterLite(page: Page, request: APIRequestContext) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: qaOrigin }]);
  await page.goto("/lite/");
  await expect(
    page
      .locator("#navigation")
      .getByRole("button", { name: "Мои КТП", exact: true }),
  ).toBeVisible();
}

test("Lite filters generation topics by class and search without losing the plan or making AI calls", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = [
    { grade: 2, topic: "Другая тема второго класса" },
    { grade: 10, topic: "Уравнения: практика" },
    { grade: 10, topic: "Геометрия" },
    { grade: 2, topic: "Уравнения: второй класс" },
  ].map((item, index) => ({
    ...plan.rows[0],
    id: randomUUID(),
    grade: null,
    topic: item.topic,
    sourceOrder: index + 1,
    source: {
      ...plan.rows[0].source,
      sheet: item.grade === 10 ? "10 класс" : "2-сынып",
    },
  }));
  expect(
    (
      await request.post(`/api/ktp/${plan.id}/confirm`, {
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
  await page.route("**/api/profile", async (route) => {
    const response = await route.fetch(),
      profile = await response.json();
    await route.fulfill({
      response,
      json: { ...profile, capabilities: { ...profile.capabilities, ai: true } },
    });
  });
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/generations", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "AI_UNAVAILABLE" }),
    });
  });
  await enterLite(page, request);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  const filterBox = await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .boundingBox();
  const firstRowBox = await page.locator("#content .row").first().boundingBox();
  expect(filterBox && firstRowBox && filterBox.y < firstRowBox.y).toBe(true);
  await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .selectOption("10");
  await page
    .getByRole("button", { name: "Создать задания", exact: true })
    .click();
  const grade = page.getByRole("combobox", { name: "Класс", exact: true });
  const topic = page.getByRole("combobox", { name: "Тема урока", exact: true });
  const search = page.getByLabel("Найти тему", { exact: true });
  const submit = page.getByRole("button", {
    name: "Создать задания",
    exact: true,
  });
  await expect(grade).toHaveValue("10");
  expect(await grade.locator("option").allTextContents()).toEqual(["2", "10"]);
  expect(await topic.locator("option").allTextContents()).toEqual([
    "Уравнения: практика",
    "Геометрия",
  ]);
  await search.fill("Уравнения");
  expect(await topic.locator("option").allTextContents()).toEqual([
    "Уравнения: практика",
  ]);
  await grade.selectOption("2");
  expect(await topic.locator("option").allTextContents()).toEqual([
    "Уравнения: второй класс",
  ]);
  await search.fill("Нет такой темы");
  await expect(topic).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(
    page.getByText("В этом классе подходящих тем нет. Измените поиск.", {
      exact: true,
    }),
  ).toBeVisible();
  await grade.selectOption("10");
  await search.fill("Уравнения");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await submit.click();
  await expect
    .poll(() => submitted)
    .toMatchObject({ planId: plan.id, rowId: rows[1].id, locale: "ru" });
  await expect(submit).toBeEnabled();
  await expect(grade).toHaveValue("10");
  await expect(search).toHaveValue("Уравнения");
  // Full-page capture temporarily resizes Chromium's viewport. Capture after
  // the real click so it cannot shift focus/scroll between mouse down and up.
  await page.screenshot({
    path: ".local/qa/lite-class-search.png",
    fullPage: true,
  });
  expect(
    (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows,
  ).toHaveLength(4);
});

test("Lite ignores a late opened curriculum after navigating to upload", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  let release!: () => void,
    pending = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/ktp/${demo.planId}`, async (route) => {
    const response = await route.fetch();
    pending = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await enterLite(page, request);
    await page.getByRole("button", { name: "Открыть", exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    await page
      .locator("#navigation")
      .getByRole("button", { name: "Загрузить КТП", exact: true })
      .click();
    release();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "Загрузить КТП", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /DEMO/ })).toHaveCount(0);
  } finally {
    release();
  }
});

test("Lite preserves edits during refresh and accepts another save before its reload finishes", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  let calls = 0,
    release!: () => void,
    releaseSaved!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const savedGate = new Promise<void>((resolve) => {
    releaseSaved = resolve;
  });
  await page.route(`**/api/ktp/${demo.planId}`, async (route) => {
    const response = await route.fetch();
    calls++;
    if (calls === 2) await gate;
    if (calls === 3) await savedGate;
    await route.fulfill({ response });
  });
  try {
    await enterLite(page, request);
    await page.getByRole("button", { name: "Открыть", exact: true }).click();
    const topic = page.getByLabel("Тема урока", { exact: true }).first();
    await expect(topic).toBeVisible();
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect.poll(() => calls).toBe(2);
    await topic.fill("Правка во время обновления");
    release();
    await page.waitForLoadState("networkidle");
    await expect(topic).toHaveValue("Правка во время обновления");
    const save = page.getByRole("button", { name: "Сохранить", exact: true });
    await save.click();
    await expect.poll(() => calls).toBe(3);
    await topic.fill("Следующая правка до завершения перечитывания");
    releaseSaved();
    await page.waitForLoadState("networkidle");
    await expect(topic).toHaveValue(
      "Следующая правка до завершения перечитывания",
    );
    await save.click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/ktp/${demo.planId}`)).json()).rows[0]
            .topic,
      )
      .toBe("Следующая правка до завершения перечитывания");
  } finally {
    release();
    releaseSaved();
  }
});

test("Lite can cancel or confirm discarding task edits and save again during a delayed reload", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const original = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  let reads = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`**/api/generations/${demo.id}`, async (route) => {
    const response = await route.fetch();
    reads++;
    if (reads === 2) await gate;
    await route.fulfill({ response });
  });
  try {
    await enterLite(page, request);
    await page
      .locator("#navigation")
      .getByRole("button", { name: "Задания", exact: true })
      .click();
    await page.getByRole("button", { name: "Открыть", exact: true }).click();
    const edit = page.getByRole("button", {
      name: "Редактировать 1",
      exact: true,
    });
    await edit.click();
    const text = page.getByLabel("Условие 1", { exact: true });
    await text.fill("Не сохранять эти изменения");
    const discard = page.getByRole("button", {
      name: "Закрыть без сохранения",
      exact: true,
    });
    await discard.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(text).toHaveValue("Не сохранять эти изменения");
    await discard.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await edit.click();
    await expect(text).toHaveValue(
      original.document.tasks[0].contentBlocks[0].text,
    );
    await text.fill("Сохранённая версия Lite");
    const save = page.getByRole("button", { name: "Сохранить", exact: true });
    await save.click();
    await expect.poll(() => reads).toBe(2);
    await text.fill("Вторая правка Lite");
    release();
    await page.waitForLoadState("networkidle");
    await expect(text).toHaveValue("Вторая правка Lite");
    await save.click();
    await expect(edit).toBeVisible();
    await edit.click();
    await text.fill("Отменить после сохранения");
    await discard.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    const saved = await (
      await request.get(`/api/generations/${demo.id}`)
    ).json();
    expect(saved.document.tasks[0].contentBlocks[0].text).toBe(
      "Вторая правка Lite",
    );
    expect(saved.revision).toBe(original.revision + 2);
    await edit.click();
    await expect(text).toHaveValue("Вторая правка Lite");
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
