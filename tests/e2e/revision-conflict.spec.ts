import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

type Kind = "plan" | "generation";
async function openEditor(page: Page, request: APIRequestContext, kind: Kind) {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const endpoint = `/api/${kind === "plan" ? "ktp" : "generations"}/${kind === "plan" ? demo.planId : demo.id}`;
  const current = await (await request.get(endpoint)).json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(kind === "plan" ? "/" : `/?generation=${demo.id}`);
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
  const save = page.getByRole("button", { name: "Сохранить", exact: true });
  const writePath = `${endpoint}/${kind === "plan" ? "rows" : "document"}`;
  return { endpoint, current, field, save, writePath };
}
async function externalWrite(
  request: APIRequestContext,
  kind: Kind,
  editor: Awaited<ReturnType<typeof openEditor>>,
) {
  const { current, writePath } = editor;
  if (kind === "plan") {
    current.rows[0].topic = "Тема другой вкладки";
    current.rows[0].notes = "Отдельное замечание другой вкладки";
  } else {
    current.document.tasks[0].contentBlocks[0].text = "Тема другой вкладки";
    current.document.tasks[0].explanationWhy =
      "Отдельное замечание другой вкладки";
  }
  expect(
    (
      await request.patch(writePath, {
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
      })
    ).status(),
  ).toBe(200);
}
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

for (const kind of ["plan", "generation"] as const) {
  test(`${kind}: teacher resolves a conflicting field while retaining independent remote changes`, async ({
    page,
    request,
  }) => {
    const editor = await openEditor(page, request, kind);
    await editor.field.fill("Моя выбранная правка");
    await externalWrite(request, kind, editor);
    await editor.save.click();
    const panel = page.locator(".revision-conflict");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("radio")).toHaveCount(2);
    await expect(editor.field).toBeDisabled();
    const apply = panel.getByRole("button", {
      name: "Применить объединение",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await expect(panel).toContainText("Моя выбранная правка");
    await expect(panel).toContainText("Тема другой вкладки");
    if (kind === "generation")
      await expect(panel).not.toContainText("paragraph");
    await page.setViewportSize({ width: 360, height: 800 });
    if (kind === "plan")
      await page.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "dark"),
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".revision-conflict").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/${kind}-revision-conflict.png`,
      fullPage: false,
    });
    await panel.locator('input[value="local"]').check();
    await apply.click();
    await expect(panel).toHaveCount(0);
    await expect(editor.field).toBeEnabled();
    await expect(editor.field).toHaveValue("Моя выбранная правка");
    expect((await (await request.get(editor.endpoint)).json()).revision).toBe(
      editor.current.revision + 1,
    );
    // Another session may save again after comparison but before our final save.
    const newer = await (await request.get(editor.endpoint)).json();
    if (kind === "plan")
      newer.rows[0].notes = "Ещё одна правка после сравнения";
    else
      newer.document.tasks[0].explanationWhy =
        "Ещё одна правка после сравнения";
    expect(
      (
        await request.patch(editor.writePath, {
          headers,
          data:
            kind === "plan"
              ? {
                  revision: newer.revision,
                  rows: newer.rows,
                  grade: newer.grade,
                  schoolYear: newer.school_year ?? "",
                }
              : { revision: newer.revision, document: newer.document },
        })
      ).status(),
    ).toBe(200);
    await editor.save.click();
    await expect(panel).toBeVisible();
    await expect(apply).toBeEnabled();
    await expect(panel.getByRole("radio")).toHaveCount(0);
    await apply.click();
    await expect(panel).toHaveCount(0);
    await editor.save.click();
    await expect
      .poll(
        async () =>
          (await (await request.get(editor.endpoint)).json()).revision,
      )
      .toBe(editor.current.revision + 3);
    const saved = await (await request.get(editor.endpoint)).json();
    expect(
      kind === "plan"
        ? saved.rows[0].topic
        : saved.document.tasks[0].contentBlocks[0].text,
    ).toBe("Моя выбранная правка");
    expect(
      kind === "plan"
        ? saved.rows[0].notes
        : saved.document.tasks[0].explanationWhy,
    ).toBe("Ещё одна правка после сравнения");
    expect(saved.status).toBe(kind === "plan" ? "review" : "needs_review");
  });

  test(`${kind}: comparison retries failed reads and requires confirmation before discarding the draft`, async ({
    page,
    request,
  }) => {
    const editor = await openEditor(page, request, kind);
    await editor.field.fill("Черновик, который нельзя потерять");
    await externalWrite(request, kind, editor);
    await page.route(`**${editor.endpoint}`, (route) =>
      route.abort("connectionfailed"),
    );
    await editor.save.click();
    const panel = page.locator(".revision-conflict");
    await expect(
      panel.getByRole("button", { name: "Повторить сравнение", exact: true }),
    ).toBeVisible();
    await expect(editor.field).toHaveValue("Черновик, который нельзя потерять");
    await page.unroute(`**${editor.endpoint}`);
    await panel
      .getByRole("button", { name: "Повторить сравнение", exact: true })
      .click();
    const remote = panel.getByRole("button", {
      name: "Использовать сохранённую версию",
      exact: true,
    });
    await remote.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(editor.field).toHaveValue("Черновик, который нельзя потерять");
    await panel
      .getByRole("button", { name: "Продолжить редактирование", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(editor.field).toBeEnabled();
    await editor.save.click();
    await expect(panel).toBeVisible();
    await remote.click();
    await dialog
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(editor.field).toHaveValue("Тема другой вкладки");
    await page
      .getByRole("button", { name: "Мои КТП", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Мои КТП", exact: true }),
    ).toBeVisible();
    await expect(dialog).not.toBeVisible();
  });

  test(`${kind}: a lost write response can be reconciled without another saved revision`, async ({
    page,
    request,
  }) => {
    const editor = await openEditor(page, request, kind);
    await editor.field.fill("Правка с потерянным подтверждением");
    await page.route(
      `**${editor.writePath}`,
      async (route) => {
        await route.fetch();
        await route.abort("connectionfailed");
      },
      { times: 1 },
    );
    await editor.save.click();
    await expect(editor.field).toBeEnabled();
    await expect
      .poll(
        async () =>
          (await (await request.get(editor.endpoint)).json()).revision,
      )
      .toBe(editor.current.revision + 1);
    await editor.save.click();
    const panel = page.locator(".revision-conflict");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button", {
        name: "Синхронизировать редактор",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(panel.getByRole("radio")).toHaveCount(0);
    await panel
      .getByRole("button", { name: "Синхронизировать редактор", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(editor.field).toHaveValue(
      "Правка с потерянным подтверждением",
    );
    await expect(page.locator(".global-error")).toHaveCount(0);
    expect((await (await request.get(editor.endpoint)).json()).revision).toBe(
      editor.current.revision + 1,
    );
    await page
      .getByRole("button", { name: "Мои КТП", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Мои КТП", exact: true }),
    ).toBeVisible();
  });
}
