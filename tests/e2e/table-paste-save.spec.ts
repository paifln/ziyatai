import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

test("pasted table cells and duplicated rows survive saving and reopening the editor", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: qaOrigin }]);
  await page.goto(`/?generation=${demo.id}`);
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  const firstTask = page.locator(".task-card").first();
  await firstTask
    .getByRole("combobox", { name: "Тип заданий", exact: true })
    .first()
    .selectOption("table");
  await firstTask
    .getByRole("textbox", { name: "Строка 1, Столбец 1", exact: true })
    .evaluate((input) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/plain",
        "Шаг\tДействие\n1\tПрибавить три\n2\tЗаписать ответ\n",
      );
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await firstTask
    .getByRole("button", { name: "Дублировать строку 3", exact: true })
    .click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeDisabled();
  const saved = await (await request.get(`/api/generations/${demo.id}`)).json();
  expect(saved.document.tasks[0].contentBlocks[0].rows).toEqual([
    ["Шаг", "Действие"],
    ["1", "Прибавить три"],
    ["2", "Записать ответ"],
    ["2", "Записать ответ"],
  ]);
  await page.reload();
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await expect(
    page
      .getByRole("textbox", { name: "Строка 4, Столбец 2", exact: true })
      .first(),
  ).toHaveValue("Записать ответ");
});
