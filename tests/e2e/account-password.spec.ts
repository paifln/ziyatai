import { origin as qaOrigin } from "./helpers";
import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function afterRateLimit(send: () => Promise<APIResponse>) {
  let response = await send();
  if (response.status() === 429)
    await expect
      .poll(
        async () => {
          response = await send();
          return response.status();
        },
        { timeout: 70000, intervals: [2000, 3000, 5000] },
      )
      .not.toBe(429);
  return response;
}

async function signIn(
  context: APIRequestContext,
  data: { email: string; password: string },
) {
  let response = await context.post("/api/auth/sign-in/email", {
    headers,
    data,
  });
  if (response.status() === 429)
    await expect
      .poll(
        async () => {
          response = await context.post("/api/auth/sign-in/email", {
            headers,
            data,
          });
          return response.status();
        },
        { timeout: 70000, intervals: [2000, 3000, 5000] },
      )
      .not.toBe(429);
  return response;
}

test("password change verifies the current secret, rotates the session and preserves profile drafts", async ({
  page,
  request,
  playwright,
}) => {
  const user = await verifiedUser(request);
  const originalSession = await (
    await request.get("/api/auth/get-session")
  ).json();
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  let release = () => {};
  try {
    expect((await signIn(other, user)).ok()).toBe(true);
    await page.context().addCookies((await request.storageState()).cookies);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    await page.getByRole("button", { name: "Профиль", exact: true }).click();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const name = page.getByLabel("Имя", { exact: true });
    const current = page.getByLabel("Текущий пароль", { exact: true });
    const next = page.getByLabel("Новый пароль", { exact: true });
    const repeat = page.getByLabel("Повторите новый пароль", { exact: true });
    const change = page.getByRole("button", {
      name: "Изменить пароль",
      exact: true,
    });
    const password = `New-${randomUUID()}`;
    let requests = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/api/auth/change-password")) requests++;
    });
    await name.fill("Сохранённое имя");
    await page
      .getByRole("combobox", { name: "Язык интерфейса", exact: true })
      .selectOption("ru");
    await current.fill(`Wrong-${randomUUID()}`);
    await next.fill(password);
    await repeat.fill(password + "different");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByText("Изменения сохранены", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(next).toHaveValue(password);
    await name.fill("Несохранённый профиль");
    await change.click();
    await expect(
      page.getByText("Новые пароли не совпадают.", { exact: true }),
    ).toBeVisible();
    expect(requests).toBe(0);
    await repeat.fill(password);
    await change.click();
    await expect(
      page.getByText("Текущий пароль указан неверно.", { exact: true }),
    ).toBeVisible();
    expect((await other.get("/api/profile")).status()).toBe(200);
    expect((await signIn(other, user)).ok()).toBe(true);
    await current.fill(user.password);
    let waiting = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/auth/change-password", async (route) => {
      expect(route.request().postDataJSON().revokeOtherSessions).toBe(true);
      const response = await route.fetch();
      waiting = true;
      await gate;
      await route.fulfill({ response });
    });
    await change.click();
    await expect.poll(() => waiting).toBe(true);
    await expect(current).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Выйти на других устройствах",
        exact: true,
      }),
    ).toBeDisabled();
    release();
    await expect(
      page.getByText("Пароль изменён. Другие сеансы завершены.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(current).toHaveValue("");
    await expect(next).toHaveValue("");
    await expect(repeat).toHaveValue("");
    expect((await page.request.get("/api/profile")).status()).toBe(200);
    expect((await other.get("/api/profile")).status()).toBe(401);
    const changedSession = await (
      await page.request.get("/api/auth/get-session")
    ).json();
    expect(changedSession.session.id !== originalSession.session.id).toBe(true);
    expect((await signIn(other, user)).status()).toBe(401);
    expect((await signIn(other, { email: user.email, password })).ok()).toBe(
      true,
    );
    await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(name).toHaveValue("Несохранённый профиль");
    await page.setViewportSize({ width: 360, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".account-security")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .locator(".account-security")
      .screenshot({ path: ".local/qa/account-password-mobile.png" });
  } finally {
    release();
    await other.dispose();
  }
});

test("password-change API rejects anonymous, cross-origin and incomplete requests", async ({
  request,
}) => {
  const input = {
    currentPassword: "Synthetic-current-password",
    newPassword: "Synthetic-new-password",
    revokeOtherSessions: true,
  };
  expect(
    (
      await request.post("/api/auth/change-password", { headers, data: input })
    ).status(),
  ).toBe(401);
  const user = await verifiedUser(request);
  expect(
    (
      await request.post("/api/auth/change-password", {
        headers: { Origin: "https://attacker.example" },
        data: { ...input, currentPassword: user.password },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/change-password", {
        headers,
        data: { newPassword: input.newPassword },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await afterRateLimit(() =>
        request.post("/api/auth/change-password", {
          headers,
          data: { currentPassword: user.password, newPassword: "short" },
        }),
      )
    ).status(),
  ).toBe(400);
  expect((await request.get("/api/profile")).status()).toBe(200);
});
