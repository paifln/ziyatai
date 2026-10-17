import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { headers, verifiedUser } from "./helpers";

test("generation searches confirmed plans beyond the dashboard limit and pages the complete collection", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const session = await (await request.get("/api/auth/get-session")).json();
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const owner = session.user.id;
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  let seeded: string[] = [];
  try {
    await pool.query(
      "UPDATE plans SET title='Archive unique curriculum',created_at=now()-interval '1 year' WHERE id=$1 AND owner_id=$2",
      [demo.planId, owner],
    );
    seeded = (
      await pool.query(
        "INSERT INTO plans(id,owner_id,title,status,created_at) SELECT gen_random_uuid(),$1,'Synthetic navigation plan '||g,CASE WHEN g<=100 THEN 'needs_review' ELSE 'confirmed' END,now()+g*interval '1 second' FROM generate_series(1,125) g RETURNING id",
        [owner],
      )
    ).rows.map((row) => row.id);
    const firstDashboardPage = await (
      await request.get("/api/ktp?limit=100")
    ).json();
    expect(
      firstDashboardPage.some((p: { id: string }) => p.id === demo.planId),
    ).toBe(false);
    const archived = await (
      await request.get("/api/ktp?status=confirmed&q=Archive%20unique")
    ).json();
    expect(archived.map((p: { id: string }) => p.id)).toEqual([demo.planId]);
    expect((await request.get("/api/ktp?status=invalid")).status()).toBe(422);
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/");
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    await page
      .getByRole("button", { name: "Создать задания", exact: true })
      .first()
      .click();
    const pager = page.getByRole("navigation", { name: "Страницы списка КТП" });
    await expect(pager).toBeVisible();
    await pager.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(
      page.locator("#confirmed-plan-choice option", {
        hasText: "Archive unique curriculum",
      }),
    ).toHaveCount(1);
    await page
      .getByLabel("Найти КТП по названию", { exact: true })
      .fill("Archive unique");
    await expect(pager).toHaveCount(0);
    const choice = page.getByRole("combobox", {
      name: "Выберите подтверждённый КТП",
      exact: true,
    });
    await expect(choice).toBeEnabled();
    await choice.selectOption(demo.planId);
    await expect(page.locator("#generation-topic option")).not.toHaveCount(0);
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width > 850) {
        await expect
          .poll(async () => {
            const side = await page.locator(".sidebar").boundingBox();
            const main = await page.locator(".main-shell").boundingBox();
            const heading = await page
              .locator(".page-heading h1")
              .boundingBox();
            return (
              !!side &&
              !!main &&
              !!heading &&
              main.x >= side.x + side.width - 1 &&
              heading.x >= side.x + side.width - 1
            );
          })
          .toBe(true);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/qa/plan-navigation-${width}.png`,
        fullPage: width < 850,
      });
    }
    await page
      .getByLabel("Найти КТП по названию", { exact: true })
      .fill("No matching synthetic plan");
    await expect(
      page.getByText("По этому названию ничего не найдено.", { exact: true }),
    ).toBeVisible();
    await expect(choice).toHaveValue(demo.planId);
  } finally {
    await pool.query(
      "DELETE FROM plans WHERE owner_id=$1 AND id=ANY($2::uuid[])",
      [owner, seeded],
    );
    await pool.end();
  }
});
