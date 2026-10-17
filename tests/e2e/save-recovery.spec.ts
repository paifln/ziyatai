import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

for (const kind of ["plan", "generation"] as const) {
  test(`${kind}: a concurrent save cannot overwrite another session or erase the local draft`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    const demo = await (
      await request.post("/api/demo", { headers, data: { locale: "ru" } })
    ).json();
    const id = kind === "plan" ? demo.planId : demo.id;
    const endpoint = `/api/${kind === "plan" ? "ktp" : "generations"}/${id}`;
    const current = await (await request.get(endpoint)).json();
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(kind === "plan" ? "/" : `/?generation=${id}`);
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    if (kind === "plan")
      await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
    else
      await page
        .getByRole("button", { name: "Доработать задание 1", exact: true })
        .click();
    const field =
      kind === "plan"
        ? page.getByLabel("Тема урока 1", { exact: true })
        : page
            .locator(".task-card")
            .first()
            .getByLabel("Текст", { exact: true })
            .first();
    await field.fill("Локальный черновик первой вкладки");
    if (kind === "plan") current.rows[0].topic = "Сохранено во второй вкладке";
    else
      current.document.tasks[0].contentBlocks[0].text =
        "Сохранено во второй вкладке";
    const writePath = `${endpoint}/${kind === "plan" ? "rows" : "document"}`;
    const write = await request.patch(writePath, {
      headers,
      data:
        kind === "plan"
          ? {
              revision: current.revision,
              rows: current.rows,
              grade: current.grade,
              schoolYear: current.school_year ?? "",
            }
          : { revision: current.revision, document: current.document },
    });
    expect(write.status()).toBe(200);
    const rejected = page.waitForResponse(
      (r) => r.url().endsWith(writePath) && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(field).toHaveValue("Локальный черновик первой вкладки");
    const saved = await (await request.get(endpoint)).json();
    expect(saved.revision).toBe(current.revision + 1);
    expect(
      kind === "plan"
        ? saved.rows[0].topic
        : saved.document.tasks[0].contentBlocks[0].text,
    ).toBe("Сохранено во второй вкладке");
    await page
      .getByRole("button", { name: "Мои КТП", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(field).toHaveValue("Локальный черновик первой вкладки");
  });

  test(`${kind}: an acknowledged save survives a failed refresh and accepts the next edit`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    const demo = await (
      await request.post("/api/demo", { headers, data: { locale: "ru" } })
    ).json();
    const id = kind === "plan" ? demo.planId : demo.id;
    const resource = kind === "plan" ? "ktp" : "generations";
    const endpoint = `/api/${resource}/${id}`;
    const original = await (await request.get(endpoint)).json();
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(kind === "plan" ? "/" : `/?generation=${id}`);
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    if (kind === "plan")
      await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
    else
      await page
        .getByRole("button", { name: "Доработать задание 1", exact: true })
        .click();
    const field =
      kind === "plan"
        ? page.getByLabel("Тема урока 1", { exact: true })
        : page
            .locator(".task-card")
            .first()
            .getByLabel("Текст", { exact: true })
            .first();
    await expect(field).toBeVisible();
    // The PATCH reaches the real server; only subsequent refreshes fail.
    await page.route(`**${endpoint}`, (route) =>
      route.abort("connectionfailed"),
    );
    try {
      const save = page.getByRole("button", { name: "Сохранить", exact: true });
      await field.fill("Сохранено до обрыва обновления");
      await save.click();
      await expect(field).toBeEnabled();
      let stored = await (await request.get(endpoint)).json();
      expect(stored.revision).toBe(original.revision + 1);
      await expect(
        page
          .locator(".small-label")
          .filter({ hasText: `Версии ${stored.revision}` }),
      ).toBeVisible();
      await field.fill("Следующая правка после обрыва");
      const response = page.waitForResponse(
        (r) =>
          r
            .url()
            .endsWith(`${endpoint}/${kind === "plan" ? "rows" : "document"}`) &&
          r.request().method() === "PATCH",
      );
      await save.click();
      expect((await response).status()).toBe(200);
      await expect(field).toBeEnabled();
      stored = await (await request.get(endpoint)).json();
      expect(stored.revision).toBe(original.revision + 2);
      expect(
        kind === "plan"
          ? stored.rows[0].topic
          : stored.document.tasks[0].contentBlocks[0].text,
      ).toBe("Следующая правка после обрыва");
      await expect(field).toHaveValue("Следующая правка после обрыва");
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
