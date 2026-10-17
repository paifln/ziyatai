import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser } from "./helpers";
import { jobDone } from "./helpers";
import { readFile } from "node:fs/promises";

test("class filtering preserves every lesson and generation class follows the selected row", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = [2, 10, 2, 10].map((grade, i) => ({
    ...plan.rows[0],
    id: randomUUID(),
    grade,
    sourceOrder: i + 1,
    topic: `${grade} класс · Урок ${i + 1}`,
  }));
  const save = await request.post(`/api/ktp/${plan.id}/confirm`, {
    headers,
    data: {
      revision: plan.revision,
      rows,
      grade: null,
      schoolYear: "2026–2027",
    },
  });
  expect(save.ok(), await save.text()).toBe(true);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .selectOption("10");
  await expect(page.getByLabel("Тема урока 2", { exact: true })).toHaveValue(
    "10 класс · Урок 2",
  );
  await expect(page.getByLabel("Тема урока 1", { exact: true })).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .selectOption("");
  await expect(page.locator(".topic-cell > textarea")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Создать задания", exact: true })
    .first()
    .click();
  const classChoice = page.getByRole("combobox", {
    name: "Класс",
    exact: true,
  });
  await classChoice.selectOption("10");
  const topics = page.locator("#generation-topic option");
  await expect(topics).toHaveCount(2);
  expect(await topics.allTextContents()).toEqual([
    "2. 10 класс · Урок 2",
    "4. 10 класс · Урок 4",
  ]);
  expect(
    (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows,
  ).toHaveLength(4);
});

test("adding a lesson under a class filter keeps it visible and saves that class", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = [2, 10].map((grade, index) => ({
    ...plan.rows[0],
    id: randomUUID(),
    grade,
    sourceOrder: index + 1,
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
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  await page
    .getByRole("combobox", { name: "Показать класс", exact: true })
    .selectOption("10");
  await page
    .getByRole("button", { name: "Добавить строку", exact: true })
    .click();
  const topic = page.getByLabel("Тема урока 3", { exact: true });
  await expect(topic).toBeVisible();
  await topic.fill("Новая тема десятого класса");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows.length,
    )
    .toBe(3);
  const saved = await (await request.get(`/api/ktp/${plan.id}`)).json();
  expect(saved.rows[2].grade).toBe(10);
  expect(saved.rows[0].grade).toBe(2);
  await expect(topic).toHaveValue("Новая тема десятого класса");
});

test("the owner's multi-class workbook keeps all 426 lessons with all eleven detected classes", async ({
  request,
}) => {
  test.skip(
    !process.env.QA_KTP_PATH,
    "Private workbook is supplied only for local acceptance",
  );
  await verifiedUser(request);
  const upload = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: "multi-class.xls",
        mimeType: "application/vnd.ms-excel",
        buffer: await readFile(process.env.QA_KTP_PATH!),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const imported = await request.post("/api/ktp/imports", {
    headers,
    data: { uploadId: (await upload.json()).id, locale: "ru", grade: 7 },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const resource = await imported.json();
  await jobDone(request, resource.jobId);
  const plan = await (await request.get(`/api/ktp/${resource.id}`)).json();
  expect(plan.rows).toHaveLength(426);
  expect(
    [...new Set(plan.rows.map((r: any) => r.grade))].sort(
      (a: any, b: any) => a - b,
    ),
  ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(plan.grade).toBe(7);
  expect(plan.rows.filter((r: any) => r.grade === 7)).toHaveLength(34);
});
