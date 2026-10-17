import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser } from "./helpers";

test("backup and conflict controls stay off the printed curriculum without changing the material", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const original = plan.rows[0].topic;
  plan.rows[0].topic = "Несохранённый резервный текст";
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
          draft: {
            rows: plan.rows,
            grade: plan.grade,
            schoolYear: plan.school_year ?? "",
          },
        },
      })
    ).status(),
  ).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  const backup = page.locator(".draft-recovery");
  await expect(backup).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(backup).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await backup
    .getByRole("button", { name: "Восстановить черновик", exact: true })
    .click();
  const conflict = page.locator(".revision-conflict");
  await expect(conflict).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(backup).toBeHidden();
  await expect(conflict).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(conflict).toBeVisible();
  expect(
    (await (await request.get(`/api/ktp/${demo.planId}`)).json()).rows[0].topic,
  ).toBe(original);
});
