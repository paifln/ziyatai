import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

async function setup(request: APIRequestContext) {
  await verifiedUser(request);
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const current = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  return { owner, demo, current, pool };
}
async function block(pool: Pool, owner: string, bucket = "snapshot") {
  await pool.query(
    "INSERT INTO api_read_budgets(owner_id,bucket,available_at) VALUES($1,$2,now()+interval '30 seconds') ON CONFLICT(owner_id,bucket) DO UPDATE SET available_at=excluded.available_at",
    [owner, bucket],
  );
}
async function release(pool: Pool, owner: string) {
  await pool.query(
    "UPDATE api_read_budgets SET available_at=now()-interval '1 minute' WHERE owner_id=$1",
    [owner],
  );
}

test("read admission is isolated by owner and work category, keeps writes available and cleans up on account deletion", async ({
  request,
  playwright,
}) => {
  const data = await setup(request);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  try {
    await block(data.pool, data.owner);
    const denied = await request.get(`/api/ktp/${data.demo.planId}`);
    expect(denied.status()).toBe(429);
    expect(denied.headers()["cache-control"]).toContain("no-store");
    expect(Number(denied.headers()["retry-after"])).toBeGreaterThan(0);
    expect(await denied.json()).toMatchObject({
      code: "READ_LIMIT",
      retryAfter: Number(denied.headers()["retry-after"]),
    });
    expect((await request.get("/api/profile")).status()).toBe(200);
    expect((await request.get("/api/auth/get-session")).status()).toBe(200);
    expect((await request.get("/api/health/live")).status()).toBe(200);
    expect(
      (await request.get(`/api/ktp/${randomUUID()}/preview`)).status(),
    ).toBe(404);
    expect((await request.get(`/api/uploads/${randomUUID()}`)).status()).toBe(
      404,
    );
    const id = randomUUID();
    expect(
      (
        await request.post("/api/drafts", {
          headers,
          data: {
            id,
            kind: "ktp",
            resourceId: data.demo.planId,
            baseRevision: data.current.revision,
            sequence: 1,
            draft: {
              rows: data.current.rows,
              grade: data.current.grade,
              schoolYear: data.current.school_year ?? "",
            },
          },
        })
      ).status(),
    ).toBe(200);
    await verifiedUser(other);
    expect((await other.get(`/api/ktp/${data.demo.planId}`)).status()).toBe(
      404,
    );
    await release(data.pool, data.owner);
    expect((await request.get(`/api/ktp/${data.demo.planId}`)).status()).toBe(
      200,
    );
    const counts = await data.pool.query(
      "SELECT bucket FROM api_read_budgets WHERE owner_id=$1",
      [data.owner],
    );
    expect(counts.rows).toHaveLength(4);
    await block(data.pool, data.owner);
    expect((await request.delete("/api/account", { headers })).status()).toBe(
      200,
    );
    await expect
      .poll(
        async () =>
          (
            await data.pool.query(
              "SELECT 1 FROM api_read_budgets WHERE owner_id=$1",
              [data.owner],
            )
          ).rowCount,
        { timeout: 45000 },
      )
      .toBe(0);
    expect((await request.get("/api/profile")).status()).toBe(401);
  } finally {
    await other.dispose();
    await data.pool.end();
  }
});

test("parallel reads share one bucket across resource IDs, rejected reads do not extend it, and real time replenishes admission", async ({
  request,
}) => {
  const data = await setup(request);
  try {
    const before = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 24 }, () =>
        request.get(`/api/uploads/${randomUUID()}`),
      ),
    );
    const elapsed = (Date.now() - before) / 1000;
    const accepted = responses.filter((r) => r.status() === 404).length;
    const denied = responses.filter((r) => r.status() === 429);
    expect(denied.length).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThanOrEqual(6);
    expect(accepted).toBeLessThanOrEqual(6 + Math.floor(elapsed / 2));
    expect(accepted + denied.length).toBe(24);
    for (const response of denied)
      expect((await response.json()).code).toBe("READ_LIMIT");
    const wait = Math.max(
      ...denied.map((r) => Number(r.headers()["retry-after"])),
    );
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(2);
    await new Promise<void>((resolve) =>
      setTimeout(resolve, (wait + 0.1) * 1000),
    );
    expect((await request.get(`/api/uploads/${randomUUID()}`)).status()).toBe(
      404,
    );
    await block(data.pool, data.owner, "download");
    const timestamp = async () =>
      (
        await data.pool.query(
          "SELECT available_at::text AS value FROM api_read_budgets WHERE owner_id=$1 AND bucket='download'",
          [data.owner],
        )
      ).rows[0].value;
    const blockedAt = await timestamp();
    for (let i = 0; i < 3; i++)
      expect((await request.get(`/api/uploads/${randomUUID()}`)).status()).toBe(
        429,
      );
    expect(await timestamp()).toBe(blockedAt);
    expect(
      (
        await data.pool.query(
          "SELECT count(*)::int AS n FROM api_read_budgets WHERE owner_id=$1 AND bucket='download'",
          [data.owner],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await data.pool.end();
  }
});

for (const kind of ["ktp", "generation"] as const) {
  test(`${kind}: a denied first load offers retry and returns to the signed-in editor`, async ({
    page,
    request,
  }) => {
    const data = await setup(request);
    try {
      await block(data.pool, data.owner);
      await page.context().addCookies((await request.storageState()).cookies);
      await page.context().addCookies([
        {
          name: "ziyatai-locale",
          value: "ru",
          domain: "localhost",
          path: "/",
        },
      ]);
      await page.goto(kind === "ktp" ? "/" : `/?generation=${data.demo.id}`);
      if (kind === "ktp")
        await page
          .locator(".resource-text")
          .filter({ hasText: "DEMO" })
          .click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Слишком частые запросы" }),
      ).toBeVisible();
      const retry = page.getByRole("button", {
        name: "Повторить",
        exact: true,
      });
      await expect(retry).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Войти", exact: true }),
      ).toHaveCount(0);
      await release(data.pool, data.owner);
      await retry.click();
      if (kind === "ktp")
        await expect(
          page.getByLabel("Тема урока 1", { exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("button", {
            name: "Доработать задание 1",
            exact: true,
          }),
        ).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: "Слишком частые запросы" }),
      ).toHaveCount(0);
    } finally {
      await data.pool.end();
    }
  });
}

for (const editor of ["main", "lite"] as const) {
  test(`${editor}: a denied profile read retains the signed-in state and recovers through retry`, async ({
    page,
    request,
  }) => {
    const data = await setup(request);
    try {
      await block(data.pool, data.owner, "metadata");
      await page.context().addCookies((await request.storageState()).cookies);
      await page.context().addCookies([
        {
          name: "ziyatai-locale",
          value: "ru",
          domain: "localhost",
          path: "/",
        },
      ]);
      await page.goto(editor === "main" ? "/" : "/lite/");
      await expect(
        (editor === "main"
          ? page.getByRole("alert")
          : page.locator("#message")
        ).filter({ hasText: "Слишком частые запросы" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Войти", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Войти", exact: true }),
      ).toHaveCount(0);
      const retry = page.getByRole("button", {
        name: "Повторить",
        exact: true,
      });
      await expect(retry).toBeVisible();
      await release(data.pool, data.owner);
      await retry.click();
      await expect(
        page
          .locator(editor === "main" ? ".resource-text" : ".resource strong")
          .filter({ hasText: "DEMO" }),
      ).toBeVisible();
    } finally {
      await data.pool.end();
    }
  });

  test(`${editor}: exhausted read budget preserves live edits and allows consecutive canonical saves`, async ({
    page,
    request,
  }) => {
    const data = await setup(request);
    try {
      await page.context().addCookies((await request.storageState()).cookies);
      await page.context().addCookies([
        {
          name: "ziyatai-locale",
          value: "ru",
          domain: "localhost",
          path: "/",
        },
      ]);
      await page.goto(editor === "main" ? "/" : "/lite/");
      if (editor === "main")
        await page
          .locator(".resource-text")
          .filter({ hasText: "DEMO" })
          .click();
      else
        await page
          .getByRole("button", { name: "Открыть", exact: true })
          .click();
      const field =
        editor === "main"
          ? page.getByLabel("Тема урока 1", { exact: true })
          : page.getByLabel("Тема урока", { exact: true }).first();
      await field.fill("Первая сохранённая правка при лимите чтения");
      await block(data.pool, data.owner);
      const save = page.getByRole("button", { name: "Сохранить", exact: true });
      const first = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/ktp/${data.demo.planId}/rows`) &&
          r.request().method() === "PATCH",
      );
      await save.click();
      expect((await first).status()).toBe(200);
      const message =
        editor === "main"
          ? page.locator(".global-error")
          : page.locator("#message");
      await expect(message).toContainText("Слишком частые запросы");
      await expect(message).toContainText("Повторите через");
      await expect(field).toHaveValue(
        "Первая сохранённая правка при лимите чтения",
      );
      await expect(field).toBeEnabled();
      await page.setViewportSize({ width: 360, height: 800 });
      if (editor === "lite")
        await page.evaluate(() =>
          document.documentElement.setAttribute("data-theme", "dark"),
        );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include(editor === "main" ? ".global-error" : "#message")
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({ path: `.local/qa/read-budget-${editor}.png` });
      await field.fill("Вторая сохранённая правка при лимите чтения");
      const second = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/ktp/${data.demo.planId}/rows`) &&
          r.request().method() === "PATCH",
      );
      await save.click();
      expect((await second).status()).toBe(200);
      await expect(field).toHaveValue(
        "Вторая сохранённая правка при лимите чтения",
      );
      await release(data.pool, data.owner);
      const stored = await (
        await request.get(`/api/ktp/${data.demo.planId}`)
      ).json();
      expect(stored.revision).toBe(data.current.revision + 2);
      expect(stored.rows[0].topic).toBe(
        "Вторая сохранённая правка при лимите чтения",
      );
    } finally {
      await data.pool.end();
    }
  });
}
