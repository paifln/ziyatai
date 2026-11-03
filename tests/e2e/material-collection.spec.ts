import { test, expect, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { headers, origin, verifiedUser } from "./helpers";

async function fixture(request: APIRequestContext) {
  await verifiedUser(request);
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  await pool.query(
    `INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale,status,created_at)
    SELECT gen_random_uuid(),owner_id,plan_id,row_id,source_snapshot,'Material_'||lpad(g::text,3,'0'),locale,
      CASE WHEN g%5=0 THEN 'failed' ELSE 'needs_review' END,now()+g*interval '1 second'
    FROM generations CROSS JOIN generate_series(1,41) g WHERE id=$1`,
    [demo.id],
  );
  await pool.query(
    `INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,status,teacher_reviewed,created_at)
    SELECT gen_random_uuid(),$1,$2,id,CASE WHEN g%2=0 THEN 'pdf' ELSE 'docx' END,
      CASE WHEN g%3=0 THEN 'full' ELSE 'student' END,'{}'::jsonb,
      CASE WHEN g%5=0 THEN 'failed' ELSE 'succeeded' END,true,now()+g*interval '1 second'
    FROM generation_versions CROSS JOIN generate_series(1,41) g WHERE generation_id=$2 AND revision=1`,
    [owner, demo.id],
  );
  return { owner, demo, pool };
}

test("material APIs page, filter and isolate metadata while preserving legacy arrays", async ({
  request,
  playwright,
}) => {
  const f = await fixture(request);
  const other = await playwright.request.newContext({
    baseURL: origin,
  });
  try {
    const history = await (
      await request.get("/api/history/collection?q=Material_&offset=999")
    ).json();
    expect(history).toMatchObject({
      total: 42,
      matched: 41,
      offset: 40,
      limit: 20,
      counts: { failed: 8, needs_review: 34 },
    });
    expect(history.items).toHaveLength(1);
    expect(history.items[0].title).toBe("Material_001");
    expect(history.items[0]).not.toHaveProperty("source_snapshot");
    expect(history.items[0]).not.toHaveProperty("owner_id");
    const failed = await (
      await request.get(
        "/api/history/collection?q=Material_&status=failed&sort=name",
      )
    ).json();
    expect(failed.matched).toBe(8);
    expect(failed.items[0].title).toBe("Material_005");
    expect(
      (await (await request.get("/api/history/collection?q=%")).json()).matched,
    ).toBe(0);
    const library = await (
      await request.get(
        "/api/library/collection?format=pdf&audience=full&status=succeeded",
      )
    ).json();
    expect(library).toMatchObject({ total: 41, matched: 5 });
    for (const item of library.items) {
      expect(item).toMatchObject({
        format: "pdf",
        audience: "full",
        status: "succeeded",
        generation_id: f.demo.id,
      });
      expect(item).not.toHaveProperty("object_key");
    }
    for (const kind of ["history", "library"]) {
      expect(
        Array.isArray(await (await request.get(`/api/${kind}`)).json()),
      ).toBe(true);
      expect((await other.get(`/api/${kind}/collection`)).status()).toBe(401);
      expect(
        (await request.delete(`/api/${kind}/collection`, { headers })).status(),
      ).toBe(405);
      for (const query of [
        "status=unknown",
        "sort=title",
        "limit=101",
        "offset=-1",
        "q=" + "x".repeat(201),
        "format=csv",
      ])
        expect(
          (await request.get(`/api/${kind}/collection?${query}`)).status(),
          query,
        ).toBe(422);
    }
    expect(
      (await request.get("/api/history/collection?format=pdf")).status(),
    ).toBe(422);
    await verifiedUser(other);
    expect(
      await (await other.get("/api/library/collection")).json(),
    ).toMatchObject({ items: [], total: 0, matched: 0 });
  } finally {
    await other.dispose();
    await f.pool.end();
  }
});

for (const kind of ["history", "library"] as const) {
  test(`${kind} filters and recovers its last page after another tab deletes the final match`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request);
    try {
      await page.context().addCookies((await request.storageState()).cookies);
      await page
        .context()
        .addCookies([{ name: "ziyatai-locale", value: "ru", url: origin }]);
      await page.goto("/");
      await page
        .locator(".sidebar")
        .getByRole("button", {
          name: kind === "history" ? "Мои задания" : "Библиотека",
          exact: true,
        })
        .click();
      await expect(page.locator(".resource-row")).toHaveCount(20);
      if (kind === "history")
        await page.getByRole("searchbox").fill("Material_");
      await expect(page.locator(".collection-caption")).toContainText(
        "1–20 / 41",
      );
      const pagination = page.getByRole("navigation", {
        name: "Страницы материалов",
      });
      await pagination
        .getByRole("button", { name: "Далее", exact: true })
        .click();
      await expect(page.locator(".collection-caption")).toContainText(
        "21–40 / 41",
      );
      await pagination
        .getByRole("button", { name: "Далее", exact: true })
        .click();
      await expect(page.locator(".resource-row")).toHaveCount(1);
      const selected = await (
        await request.get(
          `/api/${kind}/collection?offset=40${kind === "history" ? "&q=Material_" : ""}`,
        )
      ).json();
      await f.pool.query(
        `UPDATE ${kind === "history" ? "generations" : "exports"} SET deleted_at=now() WHERE id=$1 AND owner_id=$2`,
        [selected.items[0].id, f.owner],
      );
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.locator(".collection-caption")).toContainText(
        "21–40 / 40",
      );
      await expect(page.locator(".resource-row")).toHaveCount(20);
      await expect(pagination).toContainText("2 / 2");
      await page
        .getByLabel("Статус материалов", { exact: true })
        .selectOption("failed");
      await expect(page.locator(".resource-row")).toHaveCount(8);
      if (kind === "library") {
        await page
          .getByLabel("Формат файлов", { exact: true })
          .selectOption("pdf");
        await expect(page.locator(".resource-row")).toHaveCount(4);
        await page
          .getByLabel("Аудитория листов", { exact: true })
          .selectOption("full");
        await expect(page.locator(".resource-row")).toHaveCount(1);
      }
      await page.setViewportSize({ width: 360, height: 780 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.theme = value),
          theme,
        );
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
      }
    } finally {
      await f.pool.end();
    }
  });
}

test("an unavailable material collection shows retry without claiming there are no materials", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: origin }]);
  await page.route("**/api/history/collection?**", (route) =>
    route.fulfill({ status: 503, json: { code: "INTERNAL" } }),
  );
  await page.goto("/");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Мои задания", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Повторить" }),
  ).toBeVisible();
  await expect(page.locator(".empty-state")).toHaveCount(0);
  await page.unroute("**/api/history/collection?**");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator(".empty-state")).toHaveCount(1);
});
