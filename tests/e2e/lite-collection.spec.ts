import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

async function enter(page: Page, request: APIRequestContext) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/lite/");
  if ((await page.locator("#language").textContent()) === "Русский")
    await page.locator("#language").click();
  await expect(page.getByRole("search")).toBeVisible();
}

test("Lite finds an archived KTP across the collection and filters status without an empty last page", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  let seeded: string[] = [];
  try {
    await pool.query(
      "UPDATE plans SET title='Мұрағат Алгебра 7',created_at=now()-interval '1 year' WHERE id=$1 AND owner_id=$2",
      [demo.planId, owner],
    );
    seeded = (
      await pool.query(
        "INSERT INTO plans(id,owner_id,title,status,created_at) SELECT gen_random_uuid(),$1,'Synthetic Lite collection '||g,CASE WHEN g<=20 THEN 'review' ELSE 'confirmed' END,now()+g*interval '1 second' FROM generate_series(1,39) g RETURNING id",
        [owner],
      )
    ).rows.map((r) => r.id);
    await enter(page, request);
    const rows = page.locator(".resource");
    const pager = page.getByRole("navigation", {
      name: "Страницы списка материалов",
    });
    await expect(rows).toHaveCount(20);
    await pager.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(rows).toHaveCount(20);
    await expect(
      page.getByText("Мұрағат Алгебра 7", { exact: true }),
    ).toBeVisible();
    await expect(
      pager.getByRole("button", { name: "Далее", exact: true }),
    ).toHaveCount(0);
    let reads = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/ktp") reads++;
    });
    const search = page.getByRole("search");
    await search
      .getByLabel("Найти по названию", { exact: true })
      .fill("Мұрағат Алгебра");
    expect(reads).toBe(0);
    await search.getByRole("button", { name: "Найти", exact: true }).click();
    await expect(rows).toHaveCount(1);
    expect(reads).toBe(1);
    await expect(
      page.getByRole("search").getByLabel("Найти по названию"),
    ).toBeFocused();
    await expect(
      page.getByText("Материалы: 1–1", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Найти по названию", { exact: true })
      .fill("Ничего <script>");
    await page.getByLabel("Найти по названию", { exact: true }).press("Enter");
    await expect(
      page.getByText("Ничего не найдено. Измените название или фильтр.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    await expect(rows).toHaveCount(20);
    await page
      .getByLabel("Статус КТП", { exact: true })
      .selectOption("confirmed");
    await page
      .getByRole("search")
      .getByRole("button", { name: "Найти", exact: true })
      .click();
    await expect(rows).toHaveCount(20);
    await expect(
      rows.locator("small").filter({ hasText: "Подтверждено" }),
    ).toHaveCount(20);
    await expect(
      pager.getByRole("button", { name: "Далее", exact: true }),
    ).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await page.setViewportSize({ width: 360, height: 850 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .include("#content")
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({
        path: `.local/qa/lite-collection-${theme}.png`,
        fullPage: false,
      });
    }
    await rows
      .last()
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
    await expect(page.getByLabel("Учебный год", { exact: true })).toBeVisible();
    await page
      .locator("#navigation")
      .getByRole("button", { name: "Мои КТП", exact: true })
      .click();
    await expect(page.getByLabel("Статус КТП", { exact: true })).toHaveValue(
      "confirmed",
    );
    await expect(rows).toHaveCount(20);
  } finally {
    await pool.query(
      "DELETE FROM plans WHERE owner_id=$1 AND id=ANY($2::uuid[])",
      [owner, seeded],
    );
    await pool.end();
  }
});

for (const collection of ["history", "library"] as const) {
  test(`Lite ${collection} retries a failed search and ignores its result after navigation`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    const demo = await (
      await request.post("/api/demo", { headers, data: { locale: "ru" } })
    ).json();
    const session = await (await request.get("/api/auth/get-session")).json();
    const settings = parseEnv(await readFile(".env.local", "utf8"));
    const pool = new Pool({ connectionString: settings.DATABASE_URL });
    try {
      await pool.query(
        "UPDATE generations SET title='Қазақ тілі — іздеу' WHERE id=$1 AND owner_id=$2",
        [demo.id, session.user.id],
      );
      if (collection === "library")
        await pool.query(
          "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles) SELECT gen_random_uuid(),$1,$2,id,'docx','student','{}' FROM generation_versions WHERE generation_id=$2 ORDER BY revision DESC LIMIT 1",
          [session.user.id, demo.id],
        );
      await enter(page, request);
      await page
        .locator("#navigation")
        .getByRole("button", {
          name: collection === "history" ? "Задания" : "Документы",
          exact: true,
        })
        .click();
      await expect(page.locator(".resource")).toHaveCount(1);
      let fail = true;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let hold = false;
      await page.route(`**/api/${collection}?**`, async (route) => {
        const q = new URL(route.request().url()).searchParams.get("q");
        if (q === "Қазақ" && fail) {
          fail = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }),
          });
        } else {
          const response = await route.fetch();
          if (hold) await gate;
          await route.fulfill({ response });
        }
      });
      try {
        await page
          .getByLabel("Найти по названию", { exact: true })
          .fill("Қазақ");
        await page
          .getByRole("search")
          .getByRole("button", { name: "Найти", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Повторить", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("Найти по названию", { exact: true }),
        ).toHaveValue("Қазақ");
        await page
          .getByRole("button", { name: "Повторить", exact: true })
          .click();
        await expect(
          page.getByText("Қазақ тілі — іздеу", { exact: true }),
        ).toBeVisible();
        hold = true;
        const pending = page.waitForRequest(
          (r) => new URL(r.url()).pathname === `/api/${collection}`,
        );
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        await pending;
        await page
          .locator("#navigation")
          .getByRole("button", { name: "Загрузить КТП", exact: true })
          .click();
        release();
        await page.unrouteAll({ behavior: "wait" });
        await expect(
          page.getByRole("heading", { name: "Загрузить КТП", exact: true }),
        ).toBeVisible();
        await expect(page.locator(".resource")).toHaveCount(0);
        await page
          .locator("#navigation")
          .getByRole("button", {
            name: collection === "history" ? "Задания" : "Документы",
            exact: true,
          })
          .click();
        await expect(
          page.getByLabel("Найти по названию", { exact: true }),
        ).toHaveValue("Қазақ");
        await expect(page.locator(".resource")).toHaveCount(1);
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    } finally {
      if (collection === "library")
        await pool.query(
          "DELETE FROM exports WHERE owner_id=$1 AND generation_id=$2",
          [session.user.id, demo.id],
        );
      await pool.end();
    }
  });
}
