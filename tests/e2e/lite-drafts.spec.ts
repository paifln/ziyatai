import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

type Kind = "ktp" | "generation";
async function fixture(request: APIRequestContext, kind: Kind) {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const id = kind === "ktp" ? demo.planId : demo.id;
  const endpoint = `/api/${kind === "ktp" ? "ktp" : "generations"}/${id}`;
  return { id, endpoint, current: await (await request.get(endpoint)).json() };
}
async function open(page: Page, request: APIRequestContext, kind: Kind) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/lite/");
  if ((await page.locator("#language").textContent()) === "Русский")
    await page.locator("#language").click();
  if (kind === "generation")
    await page
      .locator("#navigation")
      .getByRole("button", { name: "Задания", exact: true })
      .click();
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
}
async function edit(page: Page, kind: Kind, text: string) {
  if (kind === "generation")
    await page
      .getByRole("button", { name: "Редактировать 1", exact: true })
      .click();
  const field = page
    .getByLabel(kind === "ktp" ? "Тема урока" : "Условие 1", { exact: true })
    .first();
  await field.fill(text);
  return field;
}
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

for (const kind of ["ktp", "generation"] as const) {
  test(`Lite ${kind} recovers an account backup after reload and keeps remote independent changes`, async ({
    page,
    request,
  }) => {
    const data = await fixture(request, kind);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("Storage disabled", "SecurityError");
      };
    });
    await open(page, request, kind);
    await edit(page, kind, "Резервная работа учителя Lite");
    await expect(
      page.locator(".draft-recovery").getByRole("status"),
    ).toContainText("Резервный черновик сохранён в аккаунте");
    const remote = await (await request.get(data.endpoint)).json();
    expect(remote.revision).toBe(data.current.revision);
    if (kind === "ktp")
      remote.rows[0].notes = "Независимая правка другой вкладки";
    else
      remote.document.tasks[0].explanationWhy =
        "Независимая правка другой вкладки";
    expect(
      (
        await request.patch(
          `${data.endpoint}/${kind === "ktp" ? "rows" : "document"}`,
          {
            headers,
            data:
              kind === "ktp"
                ? {
                    revision: remote.revision,
                    rows: remote.rows,
                    grade: remote.grade,
                    schoolYear: remote.school_year ?? "",
                  }
                : { revision: remote.revision, document: remote.document },
          },
        )
      ).status(),
    ).toBe(200);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload();
    if (kind === "generation")
      await page
        .locator("#navigation")
        .getByRole("button", { name: "Задания", exact: true })
        .click();
    await page.getByRole("button", { name: "Открыть", exact: true }).click();
    const backup = page.locator(".draft-recovery");
    await expect(
      backup.getByRole("button", {
        name: "Восстановить черновик",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    const restoreBox = await backup
      .getByRole("button", { name: "Восстановить черновик", exact: true })
      .boundingBox();
    expect(restoreBox!.width).toBeGreaterThan(180);
    expect(restoreBox!.height).toBeLessThan(120);
    if (kind === "ktp")
      await page.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "dark"),
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".draft-recovery").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `.local/qa/lite-${kind}-backup.png` });
    await backup
      .getByRole("button", { name: "Восстановить черновик", exact: true })
      .click();
    const comparison = page.locator(".draft-conflict");
    await comparison
      .getByRole("button", { name: "Применить объединение", exact: true })
      .click();
    expect((await (await request.get(data.endpoint)).json()).revision).toBe(
      data.current.revision + 1,
    );
    await expect(page.locator("#content")).toContainText(
      kind === "generation" ? "Резервная работа учителя Lite" : "Класс",
    );
    if (kind === "ktp")
      await expect(
        page.getByLabel("Тема урока", { exact: true }).first(),
      ).toHaveValue("Резервная работа учителя Lite");
    else {
      await page.getByRole("checkbox").check();
      await expect(
        page.getByRole("button", { name: "Одобрить задания", exact: true }),
      ).toBeDisabled();
    }
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () => (await (await request.get(data.endpoint)).json()).revision,
      )
      .toBe(data.current.revision + 2);
    const saved = await (await request.get(data.endpoint)).json();
    expect(
      kind === "ktp"
        ? saved.rows[0].topic
        : saved.document.tasks[0].contentBlocks[0].text,
    ).toBe("Резервная работа учителя Lite");
    expect(
      kind === "ktp"
        ? saved.rows[0].notes
        : saved.document.tasks[0].explanationWhy,
    ).toBe("Независимая правка другой вкладки");
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(
                `/api/drafts?kind=${kind}&resourceId=${data.id}`,
              )
            ).json()
          ).length,
      )
      .toBe(0);
    expect(errors).toEqual([]);
  });

  test(`Lite ${kind} requires an explicit choice for conflicting edits and saves the merged document`, async ({
    page,
    request,
  }) => {
    const data = await fixture(request, kind);
    await open(page, request, kind);
    const field = await edit(page, kind, "Моя правка при конфликте Lite");
    if (kind === "ktp") {
      data.current.rows[0].topic = "Сохранённая правка Lite";
      data.current.rows[0].notes = "Сохранить независимое поле";
    } else {
      data.current.document.tasks[0].contentBlocks[0].text =
        "Сохранённая правка Lite";
      data.current.document.tasks[0].explanationWhy =
        "Сохранить независимое поле";
    }
    expect(
      (
        await request.patch(
          `${data.endpoint}/${kind === "ktp" ? "rows" : "document"}`,
          {
            headers,
            data:
              kind === "ktp"
                ? {
                    revision: data.current.revision,
                    rows: data.current.rows,
                    grade: data.current.grade,
                    schoolYear: data.current.school_year ?? "",
                  }
                : {
                    revision: data.current.revision,
                    document: data.current.document,
                  },
          },
        )
      ).status(),
    ).toBe(200);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const comparison = page.locator(".draft-conflict");
    await expect(field).toBeDisabled();
    await expect(comparison.getByRole("radio")).toHaveCount(2);
    const apply = comparison.getByRole("button", {
      name: "Применить объединение",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(comparison).toContainText("Сохранённая правка Lite");
    expect(
      (await new AxeBuilder({ page }).include(".draft-conflict").analyze())
        .violations,
    ).toEqual([]);
    const choice = comparison.getByRole("radio", {
      name: "Мои правки",
      exact: true,
    });
    await choice.focus();
    await page.keyboard.press("Space");
    await expect(choice).toBeChecked();
    await expect(choice).toBeFocused();
    await apply.click();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () => (await (await request.get(data.endpoint)).json()).revision,
      )
      .toBe(data.current.revision + 2);
    const saved = await (await request.get(data.endpoint)).json();
    expect(
      kind === "ktp"
        ? saved.rows[0].topic
        : saved.document.tasks[0].contentBlocks[0].text,
    ).toBe("Моя правка при конфликте Lite");
    expect(
      kind === "ktp"
        ? saved.rows[0].notes
        : saved.document.tasks[0].explanationWhy,
    ).toBe("Сохранить независимое поле");
  });

  test(`Lite ${kind} reconciles a lost save acknowledgement without another version`, async ({
    page,
    request,
  }) => {
    const data = await fixture(request, kind);
    await open(page, request, kind);
    await edit(page, kind, "Сохранено несмотря на потерянный ответ Lite");
    const writePath = `${data.endpoint}/${kind === "ktp" ? "rows" : "tasks/" + data.current.document.tasks[0].id}`;
    await page.route(
      `**${writePath}`,
      async (route) => {
        await route.fetch();
        await route.abort("connectionfailed");
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator("#message")).toHaveClass("error");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const comparison = page.locator(".draft-conflict");
    await comparison
      .getByRole("button", { name: "Синхронизировать редактор", exact: true })
      .click();
    expect((await (await request.get(data.endpoint)).json()).revision).toBe(
      data.current.revision + 1,
    );
    await expect(page.locator("#message")).toBeHidden();
    await expect(comparison).toHaveCount(0);
  });
}

test("Lite failed autosave preserves the live draft and only retries on request", async ({
  page,
  request,
}) => {
  const data = await fixture(request, "ktp");
  await open(page, request, "ktp");
  let writes = 0;
  await page.route("**/api/drafts", (route) => {
    writes++;
    return route.abort("connectionfailed");
  });
  const field = await edit(
    page,
    "ktp",
    "Не терять правки Lite при обрыве сети",
  );
  const backup = page.locator(".draft-recovery");
  await expect(backup.getByRole("status")).toContainText(
    "Резервный черновик не обновлён",
  );
  await expect(field).toHaveValue("Не терять правки Lite при обрыве сети");
  expect(writes).toBe(1);
  expect((await (await request.get(data.endpoint)).json()).revision).toBe(
    data.current.revision,
  );
  await page.unroute("**/api/drafts");
  await backup.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(backup.getByRole("status")).toContainText(
    "Резервный черновик сохранён в аккаунте",
  );
});

test("Lite can cancel a delayed recovery read and retain its current screen", async ({
  page,
  request,
}) => {
  const data = await fixture(request, "ktp");
  await open(page, request, "ktp");
  await edit(page, "ktp", "Копия до перезагрузки");
  await expect(
    page.locator(".draft-recovery").getByRole("status"),
  ).toContainText("Резервный черновик сохранён");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  const rows = await (
    await request.get(`/api/drafts?kind=ktp&resourceId=${data.id}`)
  ).json();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/drafts/${rows[0].id}`, async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("button", { name: "Восстановить черновик", exact: true })
      .click();
    const field = page.getByLabel("Тема урока", { exact: true }).first();
    await expect(field).toBeDisabled();
    await page
      .getByRole("button", { name: "Отменить восстановление", exact: true })
      .click();
    await expect(field).toBeEnabled();
    release();
    await expect(page.locator(".draft-conflict")).toHaveCount(0);
    await expect(field).toHaveValue(data.current.rows[0].topic);
  } finally {
    release();
  }
});
