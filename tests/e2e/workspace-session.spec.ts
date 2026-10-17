import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { headers, verifiedUser } from "./helpers";

async function actor(request: APIRequestContext, pool: Pool, tag: string) {
  const credentials = await verifiedUser(request, `Private teacher ${tag}`);
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await pool.query("UPDATE plans SET title=$2 WHERE id=$1", [
    demo.planId,
    `Private ${tag} plan`,
  ]);
  await pool.query("UPDATE generations SET title=$2 WHERE id=$1", [
    demo.id,
    `Private ${tag} assignment`,
  ]);
  await pool.query(
    "INSERT INTO profiles(owner_id,school) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET school=$2",
    [owner, `Private ${tag} school`],
  );
  // Metadata-only synthetic export: no downloadable object or real document.
  await pool.query(
    "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,status) SELECT gen_random_uuid(),$1,$2,id,'docx','student','{}'::jsonb,'succeeded' FROM generation_versions WHERE generation_id=$2 AND revision=1",
    [owner, demo.id],
  );
  return { ...credentials, owner, ...demo };
}
async function enter(page: Page, request: APIRequestContext) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([
      { name: "ziyatai-locale", value: "ru", domain: "localhost", path: "/" },
    ]);
  await page.goto("/");
  await expect(page.locator(".resource-row")).toContainText("Private one plan");
}
async function switchAccount(
  page: Page,
  target: APIRequestContext,
  owner: string,
) {
  await page.context().clearCookies();
  await page.context().addCookies((await target.storageState()).cookies);
  expect((await (await notifySession(page)).json()).user.id).toBe(owner);
}
async function notifySession(page: Page, status = 200) {
  const otherTab = await page.context().newPage();
  await otherTab.goto("/privacy");
  const changed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/auth/get-session" &&
      r.status() === status,
  );
  await otherTab.evaluate(() =>
    localStorage.setItem(
      "better-auth.message",
      JSON.stringify({
        event: "session",
        data: { trigger: "signIn" },
        clientId: "synthetic-workspace-switch",
        timestamp: Date.now(),
      }),
    ),
  );
  const response = await changed;
  await page.bringToFront();
  await otherTab.close();
  return response;
}

test("same-owner session changes and temporary auth errors preserve private edits and confirmation state", async ({
  page,
  request,
}) => {
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  try {
    const first = await actor(request, pool, "one");
    await enter(page, request);
    await profile(page);
    const school = page.getByLabel("Школа (необязательно)", { exact: true });
    await school.fill("Private unsaved same-account school");
    await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.route(
      "**/api/auth/get-session",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Synthetic temporary session failure",
          }),
        }),
      { times: 1 },
    );
    expect((await notifySession(page, 503)).status()).toBe(503);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(school).toHaveValue("Private unsaved same-account school");
    await pool.query('UPDATE "user" SET name=$2 WHERE id=$1', [
      first.owner,
      "Private updated same teacher",
    ]);
    const refreshed = await (await notifySession(page)).json();
    expect(refreshed.user.id).toBe(first.owner);
    expect(refreshed.user.name).toBe("Private updated same teacher");
    await expect(
      page.getByRole("heading", { name: "Настройки", exact: true }),
    ).toBeVisible();
    await expect(school).toHaveValue("Private unsaved same-account school");
    expect((await (await request.get("/api/profile")).json()).school).toBe(
      "Private one school",
    );
  } finally {
    await pool.end();
  }
});

test("authoritative sign-out in another tab clears private forms and pending dialogs", async ({
  page,
  request,
}) => {
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  try {
    await actor(request, pool, "one");
    await enter(page, request);
    await profile(page);
    await page
      .getByLabel("Школа (необязательно)", { exact: true })
      .fill("Private unsaved logout school");
    await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      (
        await request.post("/api/auth/sign-out", { headers, data: {} })
      ).status(),
    ).toBe(200);
    expect(await (await notifySession(page)).json()).toBeNull();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.locator(".profile-card")).toHaveCount(0);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(
      await page
        .locator("input,textarea")
        .evaluateAll((fields) =>
          fields.some((f) =>
            (f as HTMLInputElement).value.includes("Private unsaved logout"),
          ),
        ),
    ).toBe(false);
  } finally {
    await pool.end();
  }
});
async function profile(page: Page) {
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
}

for (const view of [
  "profile",
  "history",
  "library",
  "plan editor",
  "assignment editor",
  "pending deletion",
  "pending account deletion",
  "delayed profile",
] as const) {
  test(`account boundary clears ${view} and preserves the first teacher's server data`, async ({
    page,
    request,
    playwright,
  }) => {
    const pool = new Pool({
      connectionString: parseEnv(await readFile(".env.local", "utf8"))
        .DATABASE_URL,
    });
    const second = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
    });
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
    let held = false;
    let aborted = false;
    let changed = false;
    const laterMutations: string[] = [];
    const heldPath =
      view === "history"
        ? "/api/history"
        : view === "library"
          ? "/api/library"
          : view === "delayed profile"
            ? "/api/profile"
            : "";
    page.on("requestfailed", (r) => {
      if (held && new URL(r.url()).pathname === heldPath) aborted = true;
    });
    page.on("request", (r) => {
      if (changed && !["GET", "HEAD", "OPTIONS"].includes(r.method()))
        laterMutations.push(new URL(r.url()).pathname);
    });
    try {
      const first = await actor(request, pool, "one");
      const next = await actor(second, pool, "two");
      await enter(page, request);
      if (view === "profile" || view === "pending account deletion") {
        await profile(page);
        await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
          first.email,
        );
        if (view === "profile") {
          await page
            .getByLabel("Школа (необязательно)", { exact: true })
            .fill("Private unsaved first school");
        } else {
          await page.getByText("Удаление аккаунта", { exact: true }).click();
          await page
            .getByRole("button", { name: "Удалить", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
        }
      } else if (
        [
          "history",
          "library",
          "assignment editor",
          "pending deletion",
        ].includes(view)
      ) {
        await page
          .getByRole("button", {
            name: view === "library" ? "Библиотека" : "Мои задания",
            exact: true,
          })
          .click();
        await expect(page.locator(".resource-row")).toContainText(
          "Private one assignment",
        );
        if (view === "assignment editor") {
          await page.locator(".resource-text").click();
          await page
            .getByRole("button", { name: "Редактировать", exact: true })
            .click();
          await page
            .locator("textarea")
            .first()
            .fill("Private unsaved first task");
        } else if (view === "pending deletion") {
          await page
            .getByRole("button", {
              name: "Удалить: Private one assignment",
              exact: true,
            })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
        }
      } else if (view === "plan editor") {
        await page.locator(".resource-text").click();
        await page
          .getByLabel("Тема урока 1", { exact: true })
          .fill("Private unsaved first lesson");
      }
      const kind = view === "plan editor" ? "ktp" : "generation";
      const resource = kind === "ktp" ? first.planId : first.id;
      if (["plan editor", "assignment editor"].includes(view))
        await expect(
          page.locator(".draft-recovery").getByRole("status"),
        ).toContainText("Резервный черновик сохранён в аккаунте");
      if (heldPath) {
        await page.route(`**${heldPath}*`, async (route) => {
          if (held) return route.continue();
          held = true;
          const response = await route.fetch();
          started();
          await gate;
          try {
            await route.fulfill({ response });
          } catch {
            /* Account teardown cancels the old request. */
          } finally {
            served();
          }
        });
        if (view === "delayed profile")
          await page.evaluate(() => window.dispatchEvent(new Event("online")));
        else
          await page
            .getByRole("button", { name: "Обновить список", exact: true })
            .click();
        await intercepted;
      }
      await switchAccount(page, second, next.owner);
      changed = true;
      await expect(
        page.getByRole("heading", { name: "Мои КТП", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".resource-row")).toContainText(
        "Private two plan",
      );
      await expect(page.locator(".profile-card")).toHaveCount(0);
      await expect(page.getByRole("dialog")).not.toBeVisible();
      expect(
        await page
          .locator("input,textarea")
          .evaluateAll((fields) =>
            fields.some((f) =>
              (f as HTMLInputElement).value.includes("Private unsaved first"),
            ),
          ),
      ).toBe(false);
      if (heldPath) {
        release();
        await completed;
        await expect.poll(() => aborted).toBe(true);
        await expect(page.locator(".resource-row")).toContainText(
          "Private two plan",
        );
      }
      await profile(page);
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
        next.email,
      );
      await expect(
        page.getByLabel("Школа (необязательно)", { exact: true }),
      ).toHaveValue("Private two school");
      expect((await (await request.get("/api/profile")).json()).school).toBe(
        "Private one school",
      );
      expect((await request.get(`/api/generations/${first.id}`)).status()).toBe(
        200,
      );
      if (["plan editor", "assignment editor"].includes(view)) {
        const drafts = await (
          await request.get(`/api/drafts?kind=${kind}&resourceId=${resource}`)
        ).json();
        expect(drafts).toHaveLength(1);
        const copy = await (
          await request.get(`/api/drafts/${drafts[0].id}`)
        ).json();
        expect(JSON.stringify(copy.draft)).toContain("Private unsaved first");
        expect(
          (
            await second.get(`/api/drafts?kind=${kind}&resourceId=${resource}`)
          ).status(),
        ).toBe(404);
      }
      expect(laterMutations).toEqual([]);
    } finally {
      release();
      await second.dispose();
      await pool.end();
    }
  });
}
