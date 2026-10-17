import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser } from "./helpers";

test("restoring a curriculum with a changed class reveals the recovered rows instead of retaining a stale filter", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const grade = plan.grade === 8 ? 9 : 8;
  const draft = {
    grade,
    schoolYear: plan.school_year ?? "",
    rows: plan.rows.map((row: Record<string, unknown>) => ({ ...row, grade })),
  };
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: {
          id: randomUUID(),
          kind: "ktp",
          resourceId: demo.planId,
          baseRevision: plan.revision,
          sequence: 1,
          draft,
        },
      })
    ).status(),
  ).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  await expect(page.getByLabel("Показать класс", { exact: true })).toHaveValue(
    String(plan.grade),
  );
  await page
    .getByRole("button", { name: "Восстановить черновик", exact: true })
    .click();
  await page
    .locator(".revision-conflict")
    .getByRole("button", { name: "Применить объединение", exact: true })
    .click();
  await expect(page.getByLabel("Класс", { exact: true })).toHaveValue(
    String(grade),
  );
  await expect(page.getByLabel("Тема урока 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Показать класс", { exact: true })).toHaveValue(
    "",
  );
  expect(
    (await (await request.get(`/api/ktp/${demo.planId}`)).json()).grade,
  ).toBe(plan.grade);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/ktp/${demo.planId}`)).json()).grade,
    )
    .toBe(grade);
});
