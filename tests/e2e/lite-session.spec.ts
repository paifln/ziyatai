import { origin as qaOrigin } from "./helpers";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

async function actor(request: APIRequestContext) {
  await verifiedUser(request);
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const response = await request.post("/api/demo", {
    headers,
    data: { locale: "ru" },
  });
  expect(response.ok()).toBe(true);
  return { owner, ...(await response.json()) };
}

async function enter(page: Page, request: APIRequestContext) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: qaOrigin }]);
  await page.goto("/lite/");
  await expect(page.locator(".resource")).toHaveCount(1);
}

for (const command of ["save", "sign-out"] as const) {
  test(`Lite binds an old ${command} to its original owner while real cookies change`, async ({
    page,
    request,
    playwright,
  }) => {
    const second = await playwright.request.newContext({
      baseURL: qaOrigin,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = true;
    try {
      const firstActor = await actor(request);
      const secondActor = await actor(second);
      const before = await (
        await request.get(`/api/ktp/${firstActor.planId}`)
      ).json();
      await enter(page, request);
      if (command === "save") {
        await page
          .getByRole("button", { name: "Открыть", exact: true })
          .click();
        await page
          .getByLabel("Учебный год", { exact: true })
          .fill("PRIVATE OLD UNSAVED YEAR");
      }
      await page.route("**/api/auth/get-session**", async (route) => {
        if (hold) await gate;
        await route.continue();
      });
      await page.context().addCookies((await second.storageState()).cookies);
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
          (command === "save"
            ? `/api/ktp/${firstActor.planId}/rows`
            : "/api/auth/sign-out"),
      );
      const reloaded = page.waitForEvent("domcontentloaded");
      await page
        .getByRole("button", {
          name: command === "save" ? "Сохранить" : "Выйти",
          exact: true,
        })
        .click();
      const rejected = await response;
      expect(rejected.status()).toBe(409);
      expect(rejected.request().headers()["x-ziyatai-account"]).toBe(
        firstActor.owner,
      );
      hold = false;
      release();
      await reloaded;
      await expect(page.locator(".resource")).toHaveCount(1);
      await expect(page.getByLabel("Учебный год", { exact: true })).toHaveCount(
        0,
      );
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/api/auth/get-session")).json())
              .user.id,
        )
        .toBe(secondActor.owner);
      const after = await (
        await request.get(`/api/ktp/${firstActor.planId}`)
      ).json();
      expect(after.revision).toBe(before.revision);
      expect(after.school_year).toBe(before.school_year);
      expect((await request.get("/api/profile")).status()).toBe(200);
      expect((await second.get("/api/profile")).status()).toBe(200);
    } finally {
      hold = false;
      release();
      await second.dispose();
    }
  });
}

test("Lite detects another account on resume without preference storage and removes an old delete dialog", async ({
  page,
  request,
  playwright,
}) => {
  const second = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    await actor(request);
    const next = await actor(second);
    await page.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("disabled");
        },
      }),
    );
    await enter(page, request);
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.context().addCookies((await second.storageState()).cookies);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".resource")).toHaveCount(1);
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/auth/get-session")).json()).user
            .id,
      )
      .toBe(next.owner);
    expect((await request.get("/api/ktp?limit=21")).ok()).toBe(true);
    expect((await (await second.get("/api/ktp?limit=21")).json()).length).toBe(
      1,
    );
  } finally {
    await second.dispose();
  }
});
