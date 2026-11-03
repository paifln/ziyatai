import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { verifiedUser } from "./helpers";

test("switching accounts in another tab cancels the old collection and never publishes its delayed response", async ({
  page,
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const firstOwner = (await (await request.get("/api/auth/get-session")).json())
    .user.id;
  const second = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
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
  try {
    await verifiedUser(second);
    const secondOwner = (
      await (await second.get("/api/auth/get-session")).json()
    ).user.id;
    await pool.query(
      "INSERT INTO plans(id,owner_id,title,status,grade) VALUES(gen_random_uuid(),$1,'Account one private curriculum','review',7),(gen_random_uuid(),$2,'Account two private curriculum','review',8)",
      [firstOwner, secondOwner],
    );
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/");
    await expect(page.locator(".resource-row")).toContainText(
      "Account one private curriculum",
    );
    let held = false;
    await page.route("**/api/ktp/collection?**", async (route) => {
      if (held) return route.continue();
      held = true;
      const response = await route.fetch();
      expect((await response.json()).items[0].title).toBe(
        "Account one private curriculum",
      );
      started();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* Expected when the old account's request is cancelled. */
      } finally {
        served();
      }
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await intercepted;
    await page.context().clearCookies();
    await page.context().addCookies((await second.storageState()).cookies);
    const otherTab = await page.context().newPage();
    await otherTab.goto("/privacy");
    const changed = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/auth/get-session" &&
        r.status() === 200,
    );
    // The installed Better Auth client broadcasts sign-in across tabs through
    // this storage event. Real synthetic sessions/cookies are used throughout.
    await otherTab.evaluate(() =>
      localStorage.setItem(
        "ziyatai.auth",
        JSON.stringify({
          event: "session",
          data: { trigger: "signIn" },
          clientId: "synthetic-account-switch",
          timestamp: Date.now(),
        }),
      ),
    );
    expect((await (await changed).json()).user.id).toBe(secondOwner);
    await page.bringToFront();
    await expect(page.locator(".resource-row")).toContainText(
      "Account two private curriculum",
    );
    release();
    await completed;
    await expect(page.locator(".resource-row")).toHaveCount(1);
    await expect(page.locator(".resource-row")).toContainText(
      "Account two private curriculum",
    );
    await expect(
      page.getByText("Account one private curriculum", { exact: true }),
    ).toHaveCount(0);
    expect(
      (await (await request.get("/api/ktp/collection")).json()).items[0].title,
    ).toBe("Account one private curriculum");
    await otherTab.close();
  } finally {
    release();
    await second.dispose();
    await pool.end();
  }
});
