import { test, expect } from "@playwright/test";
import { verifiedUser, origin } from "./helpers";

test("a delayed old sign-out response cannot clear a newer account's browser session", async ({
  page,
  request,
  playwright,
}) => {
  await verifiedUser(request, "Synthetic first response owner");
  const second = await playwright.request.newContext({
    baseURL: origin,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed!: () => void;
  const serverFinished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  try {
    await verifiedUser(second, "Synthetic second response owner");
    const next = (await (await second.get("/api/auth/get-session")).json()).user
      .id;
    await page.context().addCookies((await request.storageState()).cookies);
    await page
      .context()
      .addCookies([{ name: "ziyatai-locale", value: "ru", url: origin }]);
    await page.goto("/");
    await page.getByRole("button", { name: "Профиль", exact: true }).click();
    const transportFinished = new Promise<void>((resolve) => {
      const finish = (sent: import("@playwright/test").Request) => {
        if (new URL(sent.url()).pathname === "/api/auth/sign-out") resolve();
      };
      page.on("requestfinished", finish);
      page.on("requestfailed", finish);
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(response.headers()["set-cookie"]).toBeTruthy();
      completed();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await serverFinished;
    await page.context().addCookies((await second.storageState()).cookies);
    const other = await page.context().newPage();
    await other.goto("/privacy");
    const checked = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/auth/get-session" &&
        r.status() === 200,
    );
    await other.evaluate(() =>
      localStorage.setItem(
        "ziyatai.auth",
        JSON.stringify({
          event: "session",
          data: { trigger: "signIn" },
          clientId: "synthetic-response-test",
          timestamp: Date.now(),
        }),
      ),
    );
    expect((await (await checked).json()).user.id).toBe(next);
    await page.bringToFront();
    await other.close();
    await expect(
      page.getByRole("button", { name: "Профиль", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Профиль", exact: true }).click();
    await expect(
      page.getByText("Synthetic second response owner", { exact: true }),
    ).toBeVisible();
    release();
    await transportFinished;
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/auth/get-session")).json())?.user
            ?.id,
      )
      .toBe(next);
    await expect(
      page.getByText("Synthetic second response owner", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await second.dispose();
  }
});
