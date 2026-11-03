import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { syntheticDemo } from "../../packages/domain/demo";
import { randomUUID } from "node:crypto";

const origin = "http://localhost:3199";

async function setup(page: Page, incompleteIndex?: number) {
  let owner: string | null = "teacher-a";
  let sessionStatus = 200;
  const intents: { path: string; method: string; owner: string | undefined }[] =
    [];
  const demo = syntheticDemo("ru");
  const plan = {
    id: "synthetic-plan",
    title: "Личный КТП первого учителя",
    status: "review",
    revision: 1,
    grade: 7,
    school_year: "2026–2027",
    rows: [demo.row],
    warnings: [],
    unrecognized: [],
  };
  if (incompleteIndex !== undefined)
    plan.rows = Array.from({ length: incompleteIndex + 1 }, (_, i) => ({
      ...demo.row,
      id: randomUUID(),
      topic: `Тақырып ${i + 1}`,
      sourceOrder: i + 1,
      goals: i === incompleteIndex ? "7.1.2.1" : demo.row.goals,
    }));
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: origin }]);
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) {
      intents.push({
        path,
        method: request.method(),
        owner: request.headers()["x-ziyatai-account"],
      });
      if (path === "/api/auth/get-session") {
        await route.fulfill({
          status: sessionStatus,
          json:
            sessionStatus === 200
              ? owner
                ? { user: { id: owner } }
                : null
              : { code: "INTERNAL" },
        });
        return;
      }
      if (
        request.headers()["x-ziyatai-account"] &&
        request.headers()["x-ziyatai-account"] !== owner
      ) {
        await route.fulfill({ status: 409, json: { code: "SESSION_CHANGED" } });
        return;
      }
      const payload =
        path === "/api/public-config"
          ? { emailVerificationRequired: false }
          : path === "/api/profile"
            ? { capabilities: { demo: false, directUploads: false } }
            : path === "/api/ktp"
              ? [
                  {
                    id: plan.id,
                    title:
                      owner === "teacher-a"
                        ? plan.title
                        : "КТП второго учителя",
                    status: plan.status,
                  },
                ]
              : path === `/api/ktp/${plan.id}`
                ? plan
                : path.endsWith("/source")
                  ? { state: "unavailable", canCheck: false }
                  : [];
      await route.fulfill({ json: payload });
      return;
    }
    const files: Record<string, [string, string]> = {
      "/lite/": ["index.html", "text/html"],
      "/lite/lite.js": ["lite.js", "application/javascript"],
      "/lite/account-session.js": [
        "account-session.js",
        "application/javascript",
      ],
      "/lite/curriculum.js": ["curriculum.js", "application/javascript"],
      "/lite/drafts.js": ["drafts.js", "application/javascript"],
      "/lite/draft-merge.js": ["draft-merge.js", "application/javascript"],
      "/lite/theme.js": ["theme.js", "application/javascript"],
      "/lite/lite.css": ["lite.css", "text/css"],
    };
    const file = files[path];
    if (file)
      await route.fulfill({
        body: await readFile(`public/lite/${file[0]}`),
        contentType: file[1],
      });
    else await route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${origin}/lite/`);
  await expect(page.getByText(plan.title, { exact: true })).toBeVisible();
  return {
    intents,
    setOwner: (value: string | null) => {
      owner = value;
    },
    setStatus: (value: number) => {
      sessionStatus = value;
    },
  };
}

test("old Lite save carries the original owner and clears private forms after rejection", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await page
    .getByLabel("Учебный год", { exact: true })
    .fill("PRIVATE OLD EDIT");
  state.setOwner("teacher-b");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("КТП второго учителя", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Учебный год", { exact: true })).toHaveCount(0);
  const writes = state.intents.filter((r) => r.method === "PATCH");
  expect(writes).toEqual([
    {
      path: "/api/ktp/synthetic-plan/rows",
      method: "PATCH",
      owner: "teacher-a",
    },
  ]);
});

test("session revalidation preserves edits on 503 and clears them after a confirmed account change without localStorage", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("disabled");
      },
    }),
  );
  const state = await setup(page);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  const year = page.getByLabel("Учебный год", { exact: true });
  await year.fill("PRIVATE UNSAVED YEAR");
  state.setStatus(503);
  const checked = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/get-session") && r.status() === 503,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await checked;
  await expect(year).toHaveValue("PRIVATE UNSAVED YEAR");
  state.setStatus(200);
  state.setOwner("teacher-b");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("КТП второго учителя", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Учебный год", { exact: true })).toHaveCount(0);
  expect(state.intents.filter((r) => r.method === "PATCH")).toEqual([]);
});

test("canonical sign-out removes an open private confirmation dialog", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  state.setOwner(null);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Войти", exact: true }),
  ).toBeVisible();
  expect(state.intents.filter((r) => r.method === "DELETE")).toEqual([]);
});

test("Lite jumps to a missing objective beyond the first page and updates readiness while typing", async ({
  page,
}) => {
  await setup(page, 11);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.locator("#plan-readiness")).toHaveText(
    "Строки с пропусками: 1 / 12",
  );
  const confirm = page.getByRole("button", {
    name: "Подтвердить КТП",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page
    .getByRole("button", { name: "К первому пропуску", exact: true })
    .click();
  const goal = page.locator('[data-review-field="goals"]').last();
  await expect(goal).toBeFocused();
  await expect(goal).toHaveValue("7.1.2.1");
  await goal.fill("7.1.2.1 Алгоритм қадамдарын түсіндіру");
  await expect(confirm).toBeEnabled();
  await expect(page.locator("#plan-readiness")).toContainText(
    "Обязательные поля заполнены",
  );
});
