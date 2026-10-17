import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { headers } from "./helpers";

test("Lite registration also enters the workspace without a verification code", async ({
  page,
  request,
}) => {
  const config = await (await request.get("/api/public-config")).json();
  if (process.env.QA_REQUIRE_NO_MAIL === "1")
    expect(config.emailVerificationRequired).toBe(false);
  test.skip(
    config.emailVerificationRequired !== false,
    "Requires mail-free mode",
  );
  await page.goto("/lite/");
  await page.getByRole("button", { name: "Тіркелу", exact: true }).click();
  await page
    .getByLabel("Атыңыз", { exact: true })
    .fill("Synthetic Lite Teacher");
  await page.getByLabel("Сіздің пәніңіз", { exact: true }).fill("Математика");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`lite-no-mail-${randomBytes(6).toString("hex")}@example.test`);
  await page
    .getByLabel("Құпиясөз", { exact: true })
    .fill(randomBytes(16).toString("hex"));
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Тіркелу", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Менің КТЖ", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/profile")).ok()).toBe(true);
  expect(
    (await (await page.request.get("/api/auth/get-session")).json()).user
      .emailVerified,
  ).toBe(false);
});

test("registration without email verification creates a working session without sending a code", async ({
  page,
  request,
}) => {
  const config = await (await request.get("/api/public-config")).json();
  if (process.env.QA_REQUIRE_NO_MAIL === "1") {
    expect(config.emailVerificationRequired).toBe(false);
    expect(config.passwordResetAvailable).toBe(false);
  }
  test.skip(
    config.emailVerificationRequired !== false,
    "This scenario runs with EMAIL_VERIFICATION_REQUIRED=false",
  );
  const email = `no-mail-${randomBytes(6).toString("hex")}@example.test`,
    password = randomBytes(16).toString("hex");
  await page.goto("/signup");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByLabel("Имя", { exact: true })
    .fill("Synthetic No Mail Teacher");
  await page
    .getByLabel("Ваш предмет", { exact: true })
    .selectOption("mathematics");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мои КТП", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/profile")).ok()).toBe(true);
  const session = await (
    await page.request.get("/api/auth/get-session")
  ).json();
  expect(session.user.emailVerified).toBe(false);
  await page.request.post("/api/auth/sign-out", { headers, data: {} });
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers,
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
  expect((await page.request.get("/api/profile")).ok()).toBe(true);
  if (!config.passwordResetAvailable) {
    const reset = await page.request.post("/api/auth/request-password-reset", {
      headers,
      data: { email, redirectTo: "http://localhost:3000/" },
    });
    expect(reset.status()).toBe(503);
  }
});
