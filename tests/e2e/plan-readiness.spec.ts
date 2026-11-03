import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

test("live KTP readiness finds hidden missing fields across pages and preserves all lessons when saving", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const original = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = Array.from({ length: 30 }, (_, i) => ({
    ...original.rows[0],
    id: randomUUID(),
    sourceOrder: i + 1,
    lessonNumberRaw: String(i + 1),
    topic: `Тақырып ${i + 1}`,
    grade: i === 27 ? null : 7,
    goals: i === 26 ? "7.1.2.1" : "Алгоритм қадамдарын түсіндіру",
    source: { ...original.rows[0].source, sheet: null },
  }));
  rows[28].topic = "БЖБ №1";
  rows[28].goals = "";
  const seeded = await request.patch(`/api/ktp/${demo.planId}/rows`, {
    headers,
    data: {
      revision: original.revision,
      rows: rows.map((row, i) => ({ ...row, goalsSkipped: i === 28 })),
      grade: null,
      schoolYear: "2026–2027",
    },
  });
  expect(seeded.status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: qaOrigin }]);
  await page.goto("/");
  await page.locator(".resource-open").click();
  const readiness = page.getByRole("region", {
    name: "Готовность КТП к подтверждению",
  });
  await expect(readiness).toContainText("Строки с пропусками: 2 из 30");
  await expect(
    page.getByRole("button", { name: "Подтвердить КТП", exact: true }),
  ).toBeDisabled();
  await readiness
    .getByRole("button", { name: "Только строки с пропусками" })
    .click();
  await expect(page.locator(".ktp-table tbody tr")).toHaveCount(2);
  const goal = page.getByLabel("Цели обучения 27", { exact: true });
  await goal.fill("7.1.2.1 Алгоритм қадамдарын түсіндіру");
  await expect(goal).toBeFocused();
  await expect(readiness).toContainText("Строки с пропусками: 1 из 30");
  await expect(page.locator(".ktp-table tbody tr")).toHaveCount(2);
  await readiness.getByRole("button", { name: "К первому пропуску" }).click();
  const grade = page.getByLabel("Класс · 28", { exact: true });
  await expect(grade).toBeVisible();
  await expect(grade).toBeFocused();
  await grade.selectOption("7");
  await expect(readiness).toContainText("Обязательные поля заполнены");
  await expect(
    page.getByRole("button", { name: "Подтвердить КТП", exact: true }),
  ).toBeEnabled();
  for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    expect(
      (await new AxeBuilder({ page }).include(".plan-readiness").analyze())
        .violations,
    ).toEqual([]);
    await readiness.screenshot({
      path: test.info().outputPath(`readiness-${theme}.png`),
    });
  }
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Есть несохранённые изменения", { exact: true }),
  ).toHaveCount(0);
  const saved = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  expect(saved.rows).toHaveLength(30);
  expect(saved.rows[26].goals).toBe("7.1.2.1 Алгоритм қадамдарын түсіндіру");
  expect(saved.rows[27].grade).toBe(7);
  expect(saved.rows[28].goalsSkipped).toBe(true);
  expect(saved.status).toBe("review");
});
