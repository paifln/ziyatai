import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { headers, authRequest, verifiedUser, submitSignup } from "./helpers";

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
  expect(
    (
      await submitSignup(
        page,
        page.getByRole("button", { name: "Тіркелу", exact: true }),
      )
    ).status(),
  ).toBe(200);
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
  let limited = false;
  await page.route(
    "**/api/auth/sign-up/email",
    async (route) => {
      limited = true;
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "1" },
        contentType: "application/json",
        body: JSON.stringify({
          code: "TOO_MANY_REQUESTS",
          message: "Synthetic test limit",
        }),
      });
    },
    { times: 1 },
  );
  const signup = await submitSignup(
    page,
    page.getByRole("button", { name: "Создать аккаунт", exact: true }),
    async () => {
      await expect(page.locator(".notice[role=alert]")).toContainText(
        "Слишком много попыток",
      );
    },
  );
  expect(signup.status()).toBe(200);
  expect(limited).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Мои КТП", exact: true }),
  ).toBeVisible();
  const profile = await page.request.get("/api/profile");
  expect(profile.status()).toBe(200);
  expect(await profile.json()).toMatchObject({
    name: "Synthetic No Mail Teacher",
    teachingSubject: "mathematics",
  });
  const session = await (
    await page.request.get("/api/auth/get-session")
  ).json();
  expect(session.user.emailVerified).toBe(false);
  const signedOut = await authRequest(() =>
    page.request.post("/api/auth/sign-out", { headers, data: {} }),
  );
  expect(signedOut.status()).toBe(200);
  const signedIn = await authRequest(() =>
    page.request.post("/api/auth/sign-in/email", {
      headers,
      data: { email, password },
    }),
  );
  expect(signedIn.status()).toBe(200);
  expect((await page.request.get("/api/profile")).ok()).toBe(true);
  if (!config.passwordResetAvailable) {
    const reset = await page.request.post("/api/auth/request-password-reset", {
      headers,
      data: { email, redirectTo: qaOrigin + "/" },
    });
    expect(reset.status()).toBe(503);
  }
});

test("mail-free login retains real brute-force limits and recovers only after throttling expires", async ({
  request,
}) => {
  const config = await (await request.get("/api/public-config")).json();
  if (process.env.QA_REQUIRE_NO_MAIL === "1")
    expect(config.emailVerificationRequired).toBe(false);
  test.skip(
    config.emailVerificationRequired !== false,
    "Requires mail-free mode",
  );
  const account = await verifiedUser(request);
  expect(
    (
      await authRequest(() =>
        request.post("/api/auth/sign-out", { headers, data: {} }),
      )
    ).status(),
  ).toBe(200);
  let status = 0;
  for (let i = 0; i < 6; i++) {
    const probe = await request.post("/api/auth/sign-in/email", {
      headers,
      data: {
        email: `invalid-${randomBytes(6).toString("hex")}@example.test`,
        password: randomBytes(16).toString("hex"),
      },
    });
    status = probe.status();
    if (status === 429) break;
    expect(status).toBe(401);
  }
  expect(status, "Real authentication limiter must reject the burst").toBe(429);
  const recovered = await authRequest(() =>
    request.post("/api/auth/sign-in/email", { headers, data: account }),
  );
  expect(recovered.status()).toBe(200);
  expect((await request.get("/api/profile")).status()).toBe(200);
});
