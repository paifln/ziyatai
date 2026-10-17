import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

test("a delayed version list cannot clear edits or silently restore over a draft", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const generation = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  const originalText = generation.document.tasks[0].contentBlocks[0].text;
  generation.document.tasks[0].contentBlocks[0].text =
    "Сохранённый второй вариант задания";
  expect(
    (
      await request.patch(`/api/generations/${demo.id}/document`, {
        headers,
        data: { revision: generation.revision, document: generation.document },
      })
    ).ok(),
  ).toBe(true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseRestore = () => {};
  await page.route(`**/api/generations/${demo.id}/versions`, async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(`/?generation=${demo.id}`);
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    await page
      .getByRole("button", { name: "Доработать задание 1", exact: true })
      .click();
    const text = page
      .locator(".task-card")
      .first()
      .getByLabel("Текст", { exact: true })
      .first();
    await text.fill("Мои несохранённые изменения во время медленного ответа");
    const save = page.getByRole("button", { name: "Сохранить", exact: true });
    await expect(save).toBeEnabled();
    release();
    await expect(page.locator(".version-row")).toHaveCount(2);
    await expect(save).toBeEnabled();
    await expect(text).toHaveValue(
      "Мои несохранённые изменения во время медленного ответа",
    );
    await page.setViewportSize({ width: 360, height: 800 });
    await page
      .locator(".version-row")
      .filter({ hasText: /^1\s*·/ })
      .getByRole("button", { name: "Вернуть эту версию", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: ".local/qa/draft-restore-confirmation.png" });
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(text).toHaveValue(
      "Мои несохранённые изменения во время медленного ответа",
    );
    await expect(save).toBeEnabled();
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    await page.route(
      `**/api/generations/${demo.id}?revision=1`,
      async (route) => {
        const response = await route.fetch();
        await restoreGate;
        await route.fulfill({ response });
      },
    );
    await page
      .locator(".version-row")
      .filter({ hasText: /^1\s*·/ })
      .getByRole("button", { name: "Вернуть эту версию", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(text).toBeDisabled();
    releaseRestore();
    await expect(text).toHaveValue(originalText);
    await expect(text).toBeEnabled();
    await save.click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/generations/${demo.id}`)).json())
            .document.tasks[0].contentBlocks[0].text,
      )
      .toBe(originalText);
  } finally {
    release();
    releaseRestore();
  }
});

test("a background curriculum response cannot overwrite edits made after the request started", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/ktp/${demo.planId}`, async (route) => {
    const response = await route.fetch();
    calls++;
    if (calls === 1)
      await route.fulfill({
        response,
        json: { ...(await response.json()), status: "extracting" },
      });
    else {
      if (calls === 2) await gate;
      await route.fulfill({ response });
    }
  });
  try {
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/");
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
    const topic = page.getByLabel("Тема урока 1", { exact: true });
    await expect(topic).toBeVisible();
    await expect.poll(() => calls).toBe(2);
    await topic.fill("Правка, сделанная после начала обновления");
    release();
    await page.waitForResponse((response) =>
      response.url().endsWith(`/api/ktp/${demo.planId}`),
    );
    await expect(topic).toHaveValue(
      "Правка, сделанная после начала обновления",
    );
    const save = page.getByRole("button", { name: "Сохранить", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/ktp/${demo.planId}`)).json()).rows[0]
            .topic,
      )
      .toBe("Правка, сделанная после начала обновления");
  } finally {
    release();
  }
});
