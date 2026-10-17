import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { verifiedUser, headers, emailLink, origin } from "./helpers";

async function saveWithDelayedResponse(
  page: Page,
  path: string,
  save: Locator,
  field: Locator,
) {
  let seen = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish!: () => void;
  const handled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(path, async (route) => {
    seen = true;
    await gate;
    try {
      await route.continue();
    } finally {
      finish();
    }
  });
  try {
    await save.click();
    await expect.poll(() => seen).toBe(true);
    await expect(field).toBeDisabled();
  } finally {
    release();
    if (seen) await handled;
    await page.unroute(path);
  }
}

test("password reset links work while already signed in in both interfaces", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  for (const path of ["/", "/lite/"]) {
    const user = await verifiedUser(request);
    await page.context().addCookies((await request.storageState()).cookies);
    expect(
      (
        await request.post("/api/auth/request-password-reset", {
          headers,
          data: { email: user.email, redirectTo: origin + path },
        })
      ).ok(),
    ).toBe(true);
    const link = await emailLink(request, user.email, "Восстановление");
    const redirect = await request.get(link, { maxRedirects: 0 });
    const resetUrl = redirect.headers().location;
    if (path === "/lite/")
      await page
        .context()
        .addCookies([{ name: "ziyatai-locale", value: "kk", url: origin }]);
    await page.goto(resetUrl);
    if (path === "/")
      await page.getByRole("button", { name: "РУС", exact: true }).click();
    else if (
      await page
        .getByRole("button", { name: "Русский", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "Русский", exact: true }).click();
    const label = path === "/" ? "Установить новый пароль" : "Новый пароль";
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    const password = randomBytes(20).toString("hex");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page
      .locator("form")
      .getByRole("button", {
        name: path === "/" ? "Сохранить" : label,
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        path === "/"
          ? "Пароль изменён. Войдите с новым паролем."
          : "Пароль изменён. Теперь можно войти.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/token=/);
    expect((await request.get("/api/profile")).status()).toBe(401);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await expect
      .poll(
        async () => {
          const response = page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/auth/sign-in/email") &&
              r.request().method() === "POST",
          );
          await page
            .getByRole("button", { name: "Войти", exact: true })
            .click();
          const status = (await response).status();
          expect([200, 429]).toContain(status);
          return status;
        },
        { timeout: 30000, intervals: [2000, 3000, 5000] },
      )
      .toBe(200);
    if (path === "/")
      await expect(
        page.getByRole("heading", {
          name: "Мои КТП",
          exact: true,
        }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("button", { name: "Загрузить КТП", exact: true }),
      ).toBeVisible();
  }
});

test("large plans and assignment tables keep a bounded DOM and preserve edits across pages", async ({
  page,
  request,
  browserName,
}) => {
  await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = Array.from({ length: 53 }, (_, index) => ({
    ...plan.rows[0],
    id: randomUUID(),
    sourceOrder: index + 1,
    topic: `Проверочная тема ${index + 1}`,
  }));
  expect(
    (
      await request.patch(`/api/ktp/${plan.id}/rows`, {
        headers,
        data: {
          revision: plan.revision,
          grade: 7,
          schoolYear: "2026–2027",
          rows,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
  await page.getByText(plan.title, { exact: true }).click();
  await expect(page.locator(".ktp-table tbody tr")).toHaveCount(25);
  const planPages = page.getByRole("navigation", {
    name: "Страницы КТП",
    exact: true,
  });
  await planPages.getByRole("button", { name: "Далее", exact: true }).click();
  await planPages.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.locator(".ktp-table tbody tr")).toHaveCount(3);
  await page
    .getByLabel("Тема урока 53", { exact: true })
    .fill("Исправленная последняя тема");
  await saveWithDelayedResponse(
    page,
    "**/api/ktp/*/rows",
    page.getByRole("button", { name: "Сохранить", exact: true }),
    page.getByLabel("Тема урока 53", { exact: true }),
  );
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows[52]
          .topic,
    )
    .toBe("Исправленная последняя тема");
  const generation = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  const task = generation.document.tasks[0];
  task.contentBlocks = [
    {
      type: "table",
      text: "",
      items: [],
      language: "",
      columns: Array.from({ length: 20 }, (_, i) => `Поле ${i + 1}`),
      rows: Array.from({ length: 200 }, (_, ri) =>
        Array.from({ length: 20 }, (_, ci) => `r${ri + 1}c${ci + 1}`),
      ),
    },
  ];
  expect(
    (
      await request.patch(`/api/generations/${demo.id}/tasks/${task.id}`, {
        headers,
        data: { revision: generation.revision, task },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/?generation=${demo.id}`);
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  const table = page.locator(".task-card").first();
  await expect(table.locator(".table-grid input")).toHaveCount(220);
  await expect(
    table.getByRole("button", { name: "Добавить строку", exact: true }),
  ).toBeDisabled();
  await expect(
    table.getByRole("button", { name: "Добавить столбец", exact: true }),
  ).toBeDisabled();
  await table
    .getByRole("combobox", { name: "Страницы таблицы", exact: true })
    .selectOption("19");
  await table
    .getByLabel("Строка 200, Столбец 20", { exact: true })
    .fill("Правка последней ячейки");
  await table
    .getByRole("combobox", { name: "Страницы таблицы", exact: true })
    .selectOption("0");
  await expect(
    table.getByLabel("Строка 1, Столбец 1", { exact: true }),
  ).toHaveValue("r1c1");
  await table
    .getByRole("button", { name: "Удалить столбец 1", exact: true })
    .click();
  await table
    .getByRole("button", { name: "Удалить строку 1", exact: true })
    .click();
  await expect(
    table.getByLabel("Строка 1, Столбец 1", { exact: true }),
  ).toHaveValue("r2c2");
  await saveWithDelayedResponse(
    page,
    "**/api/generations/*/document",
    page.getByRole("button", { name: "Сохранить", exact: true }).first(),
    table.getByLabel("Строка 1, Столбец 1", { exact: true }),
  );
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/generations/${demo.id}`)).json())
          .document.tasks[0].contentBlocks[0].rows[198][18],
    )
    .toBe("Правка последней ячейки");
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
      overflow: Array.from(document.querySelectorAll("body *"))
        .filter(
          (el) =>
            !el.closest(".table-grid") &&
            el.getBoundingClientRect().right > innerWidth + 1,
        )
        .slice(0, 20)
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          width: Math.round(el.getBoundingClientRect().width),
          right: Math.round(el.getBoundingClientRect().right),
        })),
    }));
    await page.screenshot({
      path: `.local/qa/large-table-${width}.png`,
      fullPage: true,
    });
    expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(
      layout.viewport,
    );
  }
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  const saved = (
    await (await request.get(`/api/generations/${demo.id}`)).json()
  ).document.tasks[0].contentBlocks[0];
  expect(saved.rows).toHaveLength(199);
  expect(saved.columns).toHaveLength(19);
  expect(saved.rows.every((row: string[]) => row.length === 19)).toBe(true);
  expect(saved.rows[99][9]).toBe("r101c11");
  await writeFile(
    "docs/reports/large-table.json",
    JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        syntheticPlanRows: 53,
        planPageRows: 25,
        tableRowsBeforeEdit: 200,
        tableColumnsBeforeEdit: 20,
        mountedTableInputs: 220,
        rowsAfterDeletion: saved.rows.length,
        columnsAfterDeletion: saved.columns.length,
        firstMiddleAndLastCellsVerified: true,
        phoneAndTabletOverflow: false,
        wcagViolations: a11y.violations.length,
        scope: `Local compiled UI; synthetic API data and ${browserName}`,
      },
      null,
      2,
    ),
  );
});

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
  await expect(page.getByRole("heading", { name: "Менің КТЖ" })).toBeVisible();
  await expect(page.locator(".first-plan")).toBeVisible();
  let requests = 0;
  page.on("request", (r) => {
    if (
      /\/api\/(?:profile|ktp(?:\/collection)?|library|jobs)(?:\?|$)/.test(
        r.url(),
      )
    )
      requests++;
  });
  await page.clock.install();
  await page.clock.fastForward(120000);
  expect(requests).toBe(0);
  const updated = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/ktp/collection",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await updated;
  expect(requests).toBe(3);
  await page.clock.fastForward(120000);
  expect(requests).toBe(3);
});

test("both sign-in experiences are accessible and fit phones, tablets and desktops", async ({
  page,
}) => {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/login", "/lite/"]) {
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
        path: `.local/qa/redesign-${path === "/login" ? "auth" : "lite"}-${width}.png`,
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
  await expect(page.getByRole("heading", { name: "Мои КТП" })).toBeVisible();
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
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await page
    .locator(".task-card")
    .first()
    .getByLabel("Текст", { exact: true })
    .first()
    .fill("Не потерять эти изменения");
  await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
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
  const edited = page
    .locator(".task-card")
    .first()
    .getByLabel("Текст", { exact: true })
    .first();
  await page.context().setOffline(true);
  try {
    await page
      .getByRole("button", { name: "Сохранить", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Нет связи с сервером" }),
    ).toBeVisible();
    await expect(edited).toBeEnabled();
    await expect(edited).toHaveValue("Не потерять эти изменения");
  } finally {
    await page.context().setOffline(false);
  }
  await page
    .getByRole("button", { name: "Сохранить", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Изменения сохранены", { exact: true }),
  ).toBeVisible();
  const history = await (await request.get("/api/history")).json();
  const saved = await (
    await request.get(`/api/generations/${history[0].id}`)
  ).json();
  expect(saved.document.tasks[0].contentBlocks[0].text).toBe(
    "Не потерять эти изменения",
  );
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
  const condition = page.getByLabel("Условие 1", { exact: true });
  const draft = await condition.inputValue();
  await page.route("**/api/generations/*/tasks/*", (route) =>
    route.fulfill({ status: 409, json: { code: "CONFLICT" } }),
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const comparison = page.locator(".draft-conflict");
  await expect(comparison).toBeVisible();
  await expect(condition).toBeDisabled();
  await expect(condition).toHaveValue(draft);
  await comparison
    .getByRole("button", { name: "Продолжить редактирование", exact: true })
    .click();
  await expect(condition).toBeEnabled();
  await expect(condition).toHaveValue(draft);
  await page.unroute("**/api/generations/*/tasks/*");
  await page.context().setOffline(true);
  try {
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator("#message")).toHaveClass("error");
    await expect(condition).toBeEnabled();
    await expect(condition).toHaveValue(draft);
  } finally {
    await page.context().setOffline(false);
  }
  await saveWithDelayedResponse(
    page,
    "**/api/generations/*/tasks/*",
    page.getByRole("button", { name: "Сохранить", exact: true }),
    condition,
  );
  await expect(page.locator(".task").first()).toContainText(
    "Лёгкий режим: к числу 2 прибавьте 3.",
  );
  await page
    .getByLabel("Я проверил(а) задания, ответы и критерии", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Одобрить задания", exact: true })
    .click();
  await expect(
    page.getByText("Одобрено учителем", { exact: true }),
  ).toBeVisible();
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
  const oldExport = documents[0].id;
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await (await request.get("/api/library")).json()).some(
        (item: any) => item.id === oldExport,
      ),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Задания", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть", exact: true })
    .first()
    .click();
  await expect(page.locator(".task")).toHaveCount(9);
  await expect(
    page.getByText("Одобрено учителем", { exact: true }),
  ).toBeVisible();
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
  const recreated = await (await request.get("/api/library")).json();
  expect(recreated[0].id).not.toBe(oldExport);
  expect(recreated[0].teacher_reviewed).toBe(true);
});
