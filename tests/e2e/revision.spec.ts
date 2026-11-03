import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { verifiedUser, headers, jobDone } from "./helpers";

test("owner supplied workbook retains every sheet and can be separated by class", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.QA_KTP_PATH,
    "Private owner workbook is optional and never committed",
  );
  test.setTimeout(240000);
  const path = process.env.QA_KTP_PATH!;
  await verifiedUser(request);
  const upload = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: basename(path),
        mimeType: "application/vnd.ms-excel",
        buffer: await readFile(path),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const imported = await request.post("/api/ktp/imports", {
    headers,
    data: {
      uploadId: (await upload.json()).id,
      locale: "ru",
      includeHidden: false,
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const data = await imported.json();
  await jobDone(request, data.jobId);
  const plan = await (await request.get("/api/ktp/" + data.id)).json();
  expect(plan.rows).toHaveLength(426);
  expect(new Set(plan.rows.map((r: any) => r.source.sheet)).size).toBe(11);
  expect(plan.rows.filter((r: any) => !r.goals)).toHaveLength(8);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .locator(".resource-text")
    .filter({ hasText: basename(path) })
    .click();
  await page
    .getByLabel("Лист / класс", { exact: true })
    .selectOption("1 класс");
  await page
    .getByRole("button", { name: "Работать только с этим листом", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  await expect(page.getByLabel("Класс", { exact: true })).toHaveValue("1");
  await page
    .getByRole("button", { name: "Подтвердить КТП", exact: true })
    .click();
  await expect(page.getByText("Подтверждено", { exact: true })).toBeVisible();
  const selected = await (await request.get("/api/ktp/" + data.id)).json();
  expect(selected.rows).toHaveLength(17);
  expect(selected.grade).toBe(1);
});

test("upload can be cancelled during a stalled transfer", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByRole("button", { name: "Загрузить КТП", exact: true })
    .first()
    .click();
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/ru-table-1.docx");
  let uploading = false;
  await page.route("**/api/uploads", async (route) => {
    uploading = true;
    await new Promise((r) => setTimeout(r, 3000));
    await route.abort();
  });
  await page
    .getByRole("button", { name: "Извлечь строки", exact: true })
    .click();
  await expect.poll(() => uploading).toBe(true);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Мои КТП" })).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
});
