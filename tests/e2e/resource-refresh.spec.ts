import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { headers, verifiedUser } from "./helpers";

for (const kind of ["history", "library"] as const) {
  test(`${kind} coalesces resume events behind a slow request without cancelling visible results`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    const owner = (await (await request.get("/api/auth/get-session")).json())
      .user.id;
    const demo = await (
      await request.post("/api/demo", { headers, data: { locale: "ru" } })
    ).json();
    const pool = new Pool({
      connectionString: parseEnv(await readFile(".env.local", "utf8"))
        .DATABASE_URL,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    let cancelled = 0;
    try {
      if (kind === "library")
        await pool.query(
          "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,status) SELECT gen_random_uuid(),$1,$2,id,'docx','student','{}'::jsonb,'succeeded' FROM generation_versions WHERE generation_id=$2 AND revision=1",
          [owner, demo.id],
        );
      await page.context().addCookies((await request.storageState()).cookies);
      await page
        .context()
        .addCookies([{ name: "ziyatai-locale", value: "ru", url: qaOrigin }]);
      await page.goto("/");
      await page
        .locator(".sidebar")
        .getByRole("button", {
          name: kind === "history" ? "Мои задания" : "Библиотека",
          exact: true,
        })
        .click();
      await expect(page.locator(".resource-row")).toHaveCount(1);
      const title = await page.locator(".resource-row strong").textContent();
      page.on("requestfailed", (r) => {
        if (new URL(r.url()).pathname === `/api/${kind}/collection`)
          cancelled++;
      });
      await page.route(`**/api/${kind}/collection?**`, async (route) => {
        calls++;
        const response = await route.fetch();
        if (calls === 1) {
          started();
          await gate;
        }
        await route.fulfill({ response });
      });
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await pending;
      for (let i = 0; i < 4; i++)
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
      expect(calls).toBe(1);
      await expect(page.locator(".resource-row strong")).toHaveText(title!);
      release();
      await expect.poll(() => calls).toBe(2);
      await expect(page.locator("section.card")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      expect(cancelled).toBe(0);
      await expect(page.locator(".resource-row strong")).toHaveText(title!);
    } finally {
      release();
      await pool.end();
    }
  });
}
