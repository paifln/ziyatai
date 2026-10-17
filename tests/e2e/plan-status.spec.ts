import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { headers, verifiedUser } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

const states = ["extracting", "review", "confirmed", "failed", "cancelled"];
async function fixture(request: APIRequestContext) {
  await verifiedUser(request);
  const database = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const owner = (
    await database.query(
      "UPDATE plans SET title='State confirmed' WHERE id=$1 RETURNING owner_id",
      [demo.planId],
    )
  ).rows[0].owner_id;
  let cancelled = "";
  const ids: Record<string, string> = { confirmed: demo.planId };
  for (const status of states.filter((s) => s !== "confirmed")) {
    const id = randomUUID();
    await database.query(
      "INSERT INTO plans(id,owner_id,title,status,grade) VALUES($1,$2,$3,$4,7)",
      [id, owner, `State ${status}`, status],
    );
    if (status === "cancelled") cancelled = id;
    ids[status] = id;
  }
  return { database, cancelled, ids };
}

test("terminal KTP states are valid API filters and generation states cannot enter the plans table", async ({
  request,
  playwright,
}) => {
  const f = await fixture(request);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  try {
    for (const status of states) {
      const response = await request.get(`/api/ktp?status=${status}`);
      expect(response.status(), `Filter ${status}`).toBe(200);
      const plans = await response.json();
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ status, title: `State ${status}` });
    }
    for (const invalid of ["needs_review", "approved", "unknown"])
      expect((await request.get(`/api/ktp?status=${invalid}`)).status()).toBe(
        422,
      );
    await verifiedUser(other);
    expect(await (await other.get("/api/ktp?status=cancelled")).json()).toEqual(
      [],
    );
    for (const invalid of ["needs_review", "approved", "unknown", ""]) {
      await expect(
        f.database.query("UPDATE plans SET status=$2 WHERE id=$1", [
          f.cancelled,
          invalid,
        ]),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "plans_status_check",
      });
    }
    expect(
      (
        await f.database.query("SELECT status FROM plans WHERE id=$1", [
          f.cancelled,
        ])
      ).rows[0].status,
    ).toBe("cancelled");
  } finally {
    await f.database.end();
    await other.dispose();
  }
});

test("unfinished import states reject confirmation without inventing a parsed snapshot", async ({
  request,
}) => {
  const f = await fixture(request);
  try {
    const valid = await (
      await request.get(`/api/ktp/${f.ids.confirmed}`)
    ).json();
    for (const status of ["extracting", "failed", "cancelled"]) {
      const response = await request.post(`/api/ktp/${f.ids[status]}/confirm`, {
        headers,
        data: {
          revision: 1,
          rows: valid.rows,
          grade: valid.grade,
          schoolYear: valid.school_year,
        },
      });
      expect(response.status(), status).toBe(409);
      const unchanged = await (
        await request.get(`/api/ktp/${f.ids[status]}`)
      ).json();
      expect(unchanged).toMatchObject({ status, revision: 1 });
      expect(unchanged.rows).toBeUndefined();
    }
  } finally {
    await f.database.end();
  }
});

for (const lite of [false, true])
  test(`${lite ? "Lite" : "main"} finds cancelled and failed KTPs without mixing them with review`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request);
    try {
      await page.context().addCookies((await request.storageState()).cookies);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.emulateMedia({
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await page.context().addCookies([
        {
          name: "ziyatai-locale",
          value: "ru",
          domain: "localhost",
          path: "/",
        },
      ]);
      await page.goto(lite ? "/lite/" : "/");
      const filter = page.getByRole("combobox", {
        name: lite ? "Статус КТП" : "Другие статусы КТП",
        exact: true,
      });
      const rows = page.locator(lite ? ".resource" : ".resource-row");
      for (const status of ["cancelled", "failed", "extracting"]) {
        await filter.selectOption(status);
        if (lite)
          await page
            .getByRole("button", { name: "Найти", exact: true })
            .click();
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText(`State ${status}`);
        if (status === "cancelled") {
          const selector = lite ? "form[role='search']" : ".toolbar";
          expect(
            (await new AxeBuilder({ page }).include(selector).analyze())
              .violations,
          ).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page
            .locator(selector)
            .screenshot({
              path: test.info().outputPath("plan-status-light.png"),
            });
          if (lite) await page.locator("#theme-toggle").click();
          else
            await page
              .getByRole("button", {
                name: "Включить тёмную тему",
                exact: true,
              })
              .click();
          expect(
            (await new AxeBuilder({ page }).include(selector).analyze())
              .violations,
          ).toEqual([]);
          await page
            .locator(selector)
            .screenshot({
              path: test.info().outputPath("plan-status-dark.png"),
            });
        }
      }
      if (lite) {
        await filter.selectOption("review");
        await page.getByRole("button", { name: "Найти", exact: true }).click();
      } else
        await page.getByRole("button", { name: /Требуется проверка/ }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("State review");
    } finally {
      await f.database.end();
    }
  });
