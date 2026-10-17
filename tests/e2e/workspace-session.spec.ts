import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { authRequest, headers, verifiedUser } from "./helpers";

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

for (const action of [
  "profile save",
  "account deletion",
  "password change",
  "session revocation",
  "sign-out",
] as const) {
  test(`an old ${action} is rejected while the new session lookup is still pending`, async ({
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
    const extra = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let lookup: ReturnType<typeof notifySession> | undefined;
    try {
      const first = await actor(request, pool, "one");
      const next = await actor(second, pool, "two");
      if (action === "password change") {
        // Model two teachers reusing a password, using synthetic accounts only.
        await pool.query(
          'UPDATE account SET password=(SELECT password FROM account WHERE "userId"=$2 AND "providerId"=\'credential\') WHERE "userId"=$1 AND "providerId"=\'credential\'',
          [first.owner, next.owner],
        );
      }
      const passwordBefore = (
        await pool.query(
          'SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
          [next.owner],
        )
      ).rows[0].password;
      if (action === "session revocation") {
        expect(
          (
            await authRequest(() =>
              extra.post("/api/auth/sign-in/email", { headers, data: next }),
            )
          ).status(),
        ).toBe(200);
      }
      await enter(page, request);
      await profile(page);
      if (action === "profile save")
        await page
          .getByLabel("Школа (необязательно)", { exact: true })
          .fill("Old teacher intent must not enter next profile");
      if (action === "password change") {
        await page
          .getByLabel("Текущий пароль", { exact: true })
          .fill(next.password);
        await page
          .getByLabel("Новый пароль", { exact: true })
          .fill(next.password + "-changed");
        await page
          .getByLabel("Повторите новый пароль", { exact: true })
          .fill(next.password + "-changed");
      }
      await page.route("**/api/auth/get-session*", async (route) => {
        started();
        await gate;
        await route.continue();
      });
      await page.context().clearCookies();
      await page.context().addCookies((await second.storageState()).cookies);
      lookup = notifySession(page);
      void lookup.catch(() => undefined);
      await intercepted;
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
        first.email,
      );
      const result = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
            {
              "profile save": "/api/profile",
              "account deletion": "/api/account",
              "password change": "/api/auth/change-password",
              "session revocation": "/api/auth/revoke-other-sessions",
              "sign-out": "/api/auth/sign-out",
            }[action] &&
          r.request().method() ===
            (action === "profile save"
              ? "PATCH"
              : action === "account deletion"
                ? "DELETE"
                : "POST"),
      );
      if (action === "profile save") {
        await page
          .getByRole("button", { name: "Сохранить", exact: true })
          .click();
      } else if (action === "account deletion") {
        await page.getByText("Удаление аккаунта", { exact: true }).click();
        await page
          .getByRole("button", { name: "Удалить", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Удалить", exact: true })
          .click();
      } else if (action === "password change") {
        await page
          .getByRole("button", { name: "Изменить пароль", exact: true })
          .click();
      } else if (action === "session revocation") {
        await page
          .getByRole("button", {
            name: "Выйти на других устройствах",
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Продолжить", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: "Профиль", exact: true })
          .click();
        await page.getByRole("button", { name: "Выйти", exact: true }).click();
      }
      const response = await result;
      expect(response.status()).toBe(409);
      expect((await response.json()).code).toBe("SESSION_CHANGED");
      expect(response.headers()["set-cookie"]).toBeUndefined();
      if (action === "session revocation")
        expect((await extra.get("/api/profile")).status()).toBe(200);
      const passwordAfter = (
        await pool.query(
          'SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
          [next.owner],
        )
      ).rows[0].password;
      expect(passwordAfter === passwordBefore).toBe(true);
      expect((await (await second.get("/api/profile")).json()).school).toBe(
        "Private two school",
      );
      expect((await (await request.get("/api/profile")).json()).school).toBe(
        "Private one school",
      );
      release();
      await lookup;
      await expect(page.locator(".resource-row")).toContainText(
        "Private two plan",
      );
      await profile(page);
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
        next.email,
      );
    } finally {
      release();
      await lookup?.catch(() => undefined);
      if (!page.isClosed()) await page.unrouteAll({ behavior: "wait" });
      await second.dispose();
      await extra.dispose();
      await pool.end();
    }
  });
}

test("the active teacher can cancel sign-out, recover from refusal and leave normally", async ({
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
    await school.fill("Private unsaved logout draft");
    const intents: (string | undefined)[] = [];
    page.on("request", (sent) => {
      if (new URL(sent.url()).pathname === "/api/auth/sign-out")
        intents.push(sent.headers()["x-ziyatai-account"]);
    });
    async function ask() {
      if (!(await page.locator("#profile-menu").isVisible()))
        await page
          .getByRole("button", { name: "Профиль", exact: true })
          .click();
      await page.getByRole("button", { name: "Выйти", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    }
    await ask();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    expect(intents).toEqual([]);
    await expect(school).toHaveValue("Private unsaved logout draft");
    await page.route(
      "**/api/auth/sign-out",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "AUTH_UNAVAILABLE",
            message: "Synthetic sign-out refusal",
          }),
        }),
      { times: 1 },
    );
    await ask();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(page.locator(".global-error")).toBeVisible();
    await expect(school).toHaveValue("Private unsaved logout draft");
    expect(intents).toEqual([first.owner]);
    await ask();
    const signedOut = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/sign-out" &&
        response.status() === 200,
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await signedOut;
    await expect(page.locator(".profile-card")).toHaveCount(0);
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
    expect(intents).toEqual([first.owner, first.owner]);
    expect((await request.get("/api/profile")).status()).toBe(401);
  } finally {
    await pool.end();
  }
});

for (const cleanup of ["normal", "unavailable"] as const) {
  test(`the active teacher can still save settings and finish confirmed account deletion (${cleanup} cleanup)`, async ({
    page,
    request,
  }) => {
    const pool = new Pool({
      connectionString: parseEnv(await readFile(".env.local", "utf8"))
        .DATABASE_URL,
    });
    try {
      if (cleanup === "unavailable")
        await page.route("**/api/auth/sign-out", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              code: "AUTH_UNAVAILABLE",
              message: "Synthetic cleanup failure",
            }),
          }),
        );
      await actor(request, pool, "one");
      await enter(page, request);
      await profile(page);
      await page
        .getByLabel("Школа (необязательно)", { exact: true })
        .fill("Private confirmed school");
      await page
        .getByRole("combobox", { name: /^Язык интерфейса/ })
        .selectOption("ru");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect(
        page.getByText("Изменения сохранены", { exact: true }),
      ).toBeVisible();
      expect(
        (await (await page.request.get("/api/profile")).json()).school,
      ).toBe("Private confirmed school");
      await page.getByText("Удаление аккаунта", { exact: true }).click();
      await page.getByRole("button", { name: "Удалить", exact: true }).click();
      const signedOut = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/auth/sign-out",
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Удалить", exact: true })
        .click();
      expect((await signedOut).status()).toBe(cleanup === "normal" ? 200 : 503);
      await expect(page.locator(".profile-card")).toHaveCount(0);
      expect(
        await (await page.request.get("/api/auth/get-session")).json(),
      ).toBeNull();
      expect((await request.get("/api/profile")).status()).toBe(401);
    } finally {
      await pool.end();
    }
  });
}

test("a delayed profile save cannot change the next teacher's interface language", async ({
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
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    await actor(request, pool, "one");
    const next = await actor(second, pool, "two");
    await pool.query("UPDATE profiles SET locale='ru' WHERE owner_id=$1", [
      next.owner,
    ]);
    await enter(page, request);
    await profile(page);
    await page
      .getByRole("combobox", { name: /^Язык интерфейса/ })
      .selectOption("kk");
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      started();
      await gate;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await intercepted;
    await switchAccount(page, second, next.owner);
    await expect(page.locator(".resource-row")).toContainText(
      "Private two plan",
    );
    const completed = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/profile" &&
        r.request().method() === "PATCH",
    );
    release();
    await completed;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await profile(page);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
      next.email,
    );
    await expect(
      page.getByRole("combobox", { name: /^Язык интерфейса/ }),
    ).toHaveValue("ru");
    expect((await (await request.get("/api/profile")).json()).locale).toBe(
      "kk",
    );
    expect((await (await second.get("/api/profile")).json()).locale).toBe("ru");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await second.dispose();
    await pool.end();
  }
});

test("a delayed completed account deletion cannot sign out a different teacher", async ({
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
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const signouts: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/auth/sign-out")
      signouts.push(r.url());
  });
  try {
    const first = await actor(request, pool, "one");
    const next = await actor(second, pool, "two");
    await enter(page, request);
    await profile(page);
    await page.route("**/api/account", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ deleted: true });
      started();
      await gate;
      await route.fulfill({ response });
    });
    await page.getByText("Удаление аккаунта", { exact: true }).click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    await intercepted;
    expect((await request.get("/api/profile")).status()).toBe(401);
    await switchAccount(page, second, next.owner);
    await expect(page.locator(".resource-row")).toContainText(
      "Private two plan",
    );
    const completed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/account",
    );
    release();
    await completed;
    // A real browser task boundary lets the old promise continuation run.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    expect(signouts).toEqual([]);
    expect(
      (await (await page.request.get("/api/auth/get-session")).json()).user.id,
    ).toBe(next.owner);
    await profile(page);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
      next.email,
    );
    expect((await second.get("/api/profile")).status()).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM session WHERE "userId"=$1',
          [first.owner],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await second.dispose();
    await pool.end();
  }
});

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
