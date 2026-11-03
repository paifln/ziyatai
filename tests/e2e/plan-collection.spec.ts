import { origin as qaOrigin } from "./helpers";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import AxeBuilder from "@axe-core/playwright";
import { verifiedUser } from "./helpers";

async function fixture(request: APIRequestContext) {
  await verifiedUser(request);
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  await pool.query(
    "INSERT INTO plans(id,owner_id,title,status,grade,created_at) SELECT gen_random_uuid(),$1,'Collection '||lpad(g::text,3,'0'),CASE WHEN g%2=0 THEN 'confirmed' ELSE 'review' END,CASE WHEN g%2=0 THEN 7 ELSE 8 END,now()+g*interval '1 second' FROM generate_series(1,125) g",
    [owner],
  );
  const archive = (
    await pool.query(
      "INSERT INTO plans(id,owner_id,title,status,grade,created_at) VALUES(gen_random_uuid(),$1,'Archive unique school plan','cancelled',7,now()-interval '1 year') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  return { pool, owner, archive };
}
async function enter(page: Page, request: APIRequestContext) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([
      {
        name: "ziyatai-locale",
        value: "ru",
        domain: new URL(qaOrigin).hostname,
        path: "/",
      },
    ]);
  await page.goto("/");
}

test("main collection finds a KTP beyond the first hundred", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  try {
    const legacy = await (await request.get("/api/ktp?limit=100")).json();
    expect(legacy.some((p: { id: string }) => p.id === f.archive)).toBe(false);
    await enter(page, request);
    await expect(page.locator(".resource-row")).toHaveCount(20);
    await expect(
      page.getByRole("button", { name: /^Все планы\s*126$/ }),
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Найти КТП по названию", exact: true })
      .fill("Archive unique school plan");
    await expect(page.locator(".resource-row")).toHaveCount(1);
    await expect(page.locator(".resource-row")).toContainText(
      "Archive unique school plan",
    );
    await page
      .getByLabel("Другие статусы КТП", { exact: true })
      .selectOption("cancelled");
    await page
      .getByLabel("Фильтр по классу", { exact: true })
      .selectOption("7");
    await expect(page.locator(".resource-row")).toHaveCount(1);
    await expect(page.locator(".resource-row")).toContainText(
      "Archive unique school plan",
    );
    await page
      .getByLabel("Фильтр по классу", { exact: true })
      .selectOption("8");
    await expect(
      page.getByRole("heading", { name: "Таких планов пока нет" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    await expect(page.locator(".resource-row")).toHaveCount(20);
    await page.getByRole("button", { name: "ҚАЗ", exact: true }).click();
    await expect(
      page.getByRole("searchbox", {
        name: "КТЖ атауы бойынша іздеу",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Жоспарлар тізімінің беттері" }),
    ).toContainText("Бет 1 / 7");
  } finally {
    await f.pool.end();
  }
});

test("collection API returns complete bounded pages, global counts and owner-only metadata", async ({
  request,
  playwright,
}) => {
  const f = await fixture(request);
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    const ids: string[] = [];
    for (let offset = 0; offset < 126; offset += 20) {
      const response = await request.get(
        `/api/ktp/collection?offset=${offset}`,
      );
      expect(response.status(), await response.text()).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({
        total: 126,
        matched: 126,
        limit: 20,
        offset,
        counts: { confirmed: 62, review: 63, cancelled: 1 },
      });
      expect(result.items).toHaveLength(Math.min(20, 126 - offset));
      for (const item of result.items) {
        expect(Object.keys(item).sort()).toEqual([
          "created_at",
          "grade",
          "grades",
          "id",
          "school_year",
          "status",
          "title",
        ]);
        expect(item.grades).toEqual([item.grade]);
        ids.push(item.id);
      }
    }
    expect(new Set(ids).size).toBe(126);
    expect(ids.at(-1)).toBe(f.archive);
    const legacyBytes = (await (await request.get("/api/ktp?limit=100")).body())
      .byteLength;
    const pageBytes = (await (await request.get("/api/ktp/collection")).body())
      .byteLength;
    expect(pageBytes).toBeLessThan(legacyBytes / 2);
    await writeFile(
      test.info().outputPath("transfer.json"),
      JSON.stringify(
        {
          fixturePlans: 126,
          legacyFirstPageItems: 100,
          collectionFirstPageItems: 20,
          legacyBytes,
          pageBytes,
          note: "Local uncompressed response payload; does not establish end-to-end latency or physical device performance",
        },
        null,
        2,
      ),
    );
    const filtered = await (
      await request.get(
        "/api/ktp/collection?status=review&grade=8&sort=name&offset=1000000",
      )
    ).json();
    expect(filtered).toMatchObject({ total: 126, matched: 63, offset: 60 });
    expect(filtered.items.map((p: { title: string }) => p.title)).toEqual([
      "Collection 121",
      "Collection 123",
      "Collection 125",
    ]);
    const cancelled = await (
      await request.get("/api/ktp/collection?status=cancelled&grade=7")
    ).json();
    expect(cancelled.items.map((p: { id: string }) => p.id)).toEqual([
      f.archive,
    ]);
    expect((await other.get("/api/ktp/collection")).status()).toBe(401);
    await verifiedUser(other);
    expect(await (await other.get("/api/ktp/collection")).json()).toMatchObject(
      { items: [], total: 0, matched: 0, counts: {} },
    );
    expect((await other.delete("/api/ktp/collection")).status()).toBe(405);
    expect((await request.get("/api/ktp/collection/extra")).status()).toBe(404);
  } finally {
    await other.dispose();
    await f.pool.end();
  }
});

test("collection search treats SQL wildcards literally and validates all paging inputs", async ({
  request,
}) => {
  const f = await fixture(request);
  try {
    await f.pool.query(
      "INSERT INTO plans(id,owner_id,title,status) VALUES(gen_random_uuid(),$1,'Literal 100%_match','review'),(gen_random_uuid(),$1,'Мұрағат Әліппе 7','review')",
      [f.owner],
    );
    for (const q of ["100%_", "%_", "100%_match"]) {
      const result = await (
        await request.get(`/api/ktp/collection?q=${encodeURIComponent(q)}`)
      ).json();
      expect(result.matched).toBe(1);
      expect(result.items[0].title).toBe("Literal 100%_match");
    }
    for (const q of ["мұрағат әліппе", "МҰРАҒАТ ӘЛІППЕ"]) {
      const result = await (
        await request.get(`/api/ktp/collection?q=${encodeURIComponent(q)}`)
      ).json();
      expect(result.matched).toBe(1);
      expect(result.items[0].title).toBe("Мұрағат Әліппе 7");
    }
    for (const q of ["' OR 1=1 --", "<script>", "\\"])
      expect(
        (
          await (
            await request.get(`/api/ktp/collection?q=${encodeURIComponent(q)}`)
          ).json()
        ).matched,
      ).toBe(0);
    for (const query of [
      "grade=12",
      "grade=0",
      "grade=7.5",
      "grade=abc",
      "status=approved",
      "sort=title;DROP TABLE plans",
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=NaN",
      "offset=-1",
      "offset=1000001",
      `q=${"a".repeat(201)}`,
    ])
      expect(
        (await request.get(`/api/ktp/collection?${query}`)).status(),
        query,
      ).toBe(422);
    await f.pool.query(
      "UPDATE plans SET deleted_at=now() WHERE owner_id=$1 AND id=$2",
      [f.owner, f.archive],
    );
    const removed = await (
      await request.get("/api/ktp/collection?q=Archive")
    ).json();
    expect(removed).toMatchObject({
      items: [],
      matched: 0,
      total: 127,
      offset: 0,
    });
    expect(removed.counts.cancelled).toBeUndefined();
    expect((await request.get("/api/ktp?limit=100")).status()).toBe(200);
  } finally {
    await f.pool.end();
  }
});

test("main pages, sorts and recovers the last page after deleting its final result", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  try {
    await enter(page, request);
    const pager = page.getByRole("navigation", {
      name: "Страницы списка планов",
    });
    await expect(page.locator(".resource-row")).toHaveCount(20);
    await pager.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(pager).toContainText("Страница 2 / 7");
    await expect(page.locator(".collection-caption")).toBeFocused();
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        expect(
          (
            await new AxeBuilder({ page })
              .include(".collection-pagination")
              .include(".plan-toolbar")
              .analyze()
          ).violations,
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await pager.screenshot({
          path: test.info().outputPath(`pager-${width}-${theme}.png`),
        });
      }
    }
    await page
      .getByLabel("Порядок планов", { exact: true })
      .selectOption("name");
    await expect(pager).toContainText("Страница 1 / 7");
    await expect(page.locator(".resource-row").first()).toContainText(
      "Archive unique school plan",
    );
    await page
      .getByLabel("Фильтр по классу", { exact: true })
      .selectOption("7");
    await expect(pager).toContainText("Страница 1 / 4");
    await page.getByRole("button", { name: /^Требуется проверка/ }).click();
    await expect(
      page.getByRole("heading", { name: "Таких планов пока нет" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    await page
      .getByLabel("Найти КТП по названию", { exact: true })
      .fill("Collection 0");
    await expect(pager).toContainText("Страница 1 / 5");
    for (let i = 0; i < 4; i++) {
      await pager.getByRole("button", { name: "Далее", exact: true }).click();
      await expect(pager).toContainText(`Страница ${i + 2} / 5`);
    }
    // Simulate another tab deleting all but the first twenty matching plans.
    await f.pool.query(
      "UPDATE plans SET deleted_at=now() WHERE owner_id=$1 AND title LIKE 'Collection 0%' AND title>'Collection 020'",
      [f.owner],
    );
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".resource-row")).toHaveCount(20);
    await expect(pager).toHaveCount(0);
    await expect(page.locator(".collection-caption")).toContainText(
      "1–20 / 20",
    );
    await expect(
      page.getByLabel("Найти КТП по названию", { exact: true }),
    ).toHaveValue("Collection 0");
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      expect(
        (
          await new AxeBuilder({ page })
            .include(".plan-toolbar")
            .include(".plan-list")
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .locator(".plan-toolbar")
        .screenshot({ path: test.info().outputPath(`${theme}.png`) });
    }
  } finally {
    await f.pool.end();
  }
});

test("a failed collection request keeps filters and offers retry without a false empty state", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  try {
    await enter(page, request);
    await expect(page.locator(".resource-row")).toHaveCount(20);
    await page.route("**/api/ktp/collection?**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "INTERNAL" }),
      }),
    );
    await page
      .getByLabel("Найти КТП по названию", { exact: true })
      .fill("Archive unique");
    await expect(page.locator(".notice[role=alert]")).toBeVisible();
    await expect(page.locator(".first-plan")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Таких планов пока нет" }),
    ).toHaveCount(0);
    await page.unroute("**/api/ktp/collection?**");
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(page.locator(".resource-row")).toHaveCount(1);
    await expect(page.locator(".resource-row")).toContainText(
      "Archive unique school plan",
    );
    await expect(
      page.getByLabel("Найти КТП по названию", { exact: true }),
    ).toHaveValue("Archive unique");
  } finally {
    await f.pool.end();
  }
});

for (const slow of ["search", "page"] as const)
  test(`a superseded ${slow} is aborted and its delayed response cannot replace the new results`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request);
    let release!: () => void;
    let started!: () => void;
    let served!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      served = resolve;
    });
    let aborted = false;
    const isDelayed = (url: URL) =>
      url.pathname === "/api/ktp/collection" &&
      (slow === "search"
        ? url.searchParams.get("q") === "Collection"
        : url.searchParams.get("offset") === "20" &&
          !url.searchParams.get("q"));
    page.on("requestfailed", (r) => {
      const url = new URL(r.url());
      if (isDelayed(url)) aborted = true;
    });
    try {
      await enter(page, request);
      await expect(page.locator(".resource-row")).toHaveCount(20);
      await page.route("**/api/ktp/collection?**", async (route) => {
        if (!isDelayed(new URL(route.request().url()))) return route.continue();
        const response = await route.fetch();
        started();
        await gate;
        try {
          await route.fulfill({ response });
        } catch {
          /* The browser deliberately cancelled this older request. */
        } finally {
          served();
        }
      });
      const search = page.getByLabel("Найти КТП по названию", { exact: true });
      if (slow === "search") await search.fill("Collection");
      else
        await page
          .getByRole("navigation", { name: "Страницы списка планов" })
          .getByRole("button", { name: "Далее", exact: true })
          .click();
      await intercepted;
      await search.fill("Archive unique");
      await expect(page.locator(".resource-row")).toHaveCount(1);
      await expect(page.locator(".resource-row")).toContainText(
        "Archive unique school plan",
      );
      release();
      await completed;
      await expect.poll(() => aborted).toBe(true);
      await expect(search).toBeFocused();
      await expect(page.locator(".resource-row")).toHaveCount(1);
      await expect(page.locator(".resource-row")).toContainText(
        "Archive unique school plan",
      );
    } finally {
      release();
      await f.pool.end();
    }
  });

test("passive refreshes preserve visible plans and coalesce behind a slow in-flight request", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  try {
    await enter(page, request);
    await expect(page.locator(".resource-row")).toHaveCount(20);
    await page.route("**/api/ktp/collection?**", async (route) => {
      calls++;
      if (calls !== 1) return route.continue();
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await intercepted;
    await expect(page.locator(".resource-row")).toHaveCount(20);
    for (let i = 0; i < 2; i++) {
      const refresh = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/jobs",
      );
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await refresh;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
    expect(calls).toBe(1);
    release();
    await expect.poll(() => calls).toBe(2);
    await expect(page.locator(".plan-list")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".resource-row")).toHaveCount(20);
  } finally {
    release();
    await f.pool.end();
  }
});
