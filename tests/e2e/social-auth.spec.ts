import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("configured Google starts a state-bound flow and rejects an untrusted return URL", async ({
  request,
}) => {
  test.skip(
    process.env.QA_SOCIAL_CONFIGURED !== "1",
    "Requires synthetic Google credentials; no provider callback is contacted",
  );
  const response = await request.post("/api/auth/sign-in/social", {
    headers: { Origin: "http://localhost:3000" },
    data: {
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/login?oauthError=1",
      disableRedirect: true,
    },
  });
  expect(response.status()).toBe(200);
  const url = new URL((await response.json()).url);
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "http://localhost:3000/api/auth/callback/google",
  );
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const unsafe = await request.post("/api/auth/sign-in/social", {
    headers: { Origin: "http://localhost:3000" },
    data: {
      provider: "google",
      callbackURL: "https://untrusted.example.test/",
      disableRedirect: true,
    },
  });
  expect(unsafe.status()).toBe(403);
  const invalidState = await request.get(
    "/api/auth/callback/google?state=invalid-state&code=synthetic",
    { maxRedirects: 0 },
  );
  expect(invalidState.status()).toBe(302);
  expect(
    (await (await request.get("/api/auth/get-session")).json())?.user,
  ).toBeFalsy();
});

for (const path of ["/login", "/signup", "/lite/"]) {
  test(`social sign-in is accessible and honest when unconfigured: ${path}`, async ({
    page,
    request,
  }) => {
    const config = await (await request.get("/api/public-config")).json();
    test.skip(
      config.socialProviders?.google || config.socialProviders?.apple,
      "Requires unconfigured providers",
    );
    expect(config.socialProviders).toEqual({ google: false, apple: false });
    await page
      .context()
      .addCookies([
        { name: "ziyatai-locale", value: "ru", domain: "localhost", path: "/" },
      ]);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(path);
    for (const provider of ["Google", "Apple"]) {
      await page
        .getByRole("button", { name: `Продолжить с ${provider}`, exact: true })
        .click();
      await expect(
        page.getByText(
          `Вход через ${provider} пока не подключён. Войдите по почте.`,
          { exact: true },
        ),
      ).toBeVisible();
      expect(new URL(page.url()).pathname.replace(/\/$/, "")).toBe(
        path.replace(/\/$/, ""),
      );
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      expect(
        (await new AxeBuilder({ page }).include(".social-auth").analyze())
          .violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .locator(".social-auth")
        .screenshot({ path: test.info().outputPath(`${colorScheme}.png`) });
    }
  });
}

test("OAuth cancellation returns to an actionable login form", async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: "ziyatai-locale", value: "ru", domain: "localhost", path: "/" },
    ]);
  await page.goto("/login?oauthError=1&error=access_denied");
  await expect(
    page.getByText(/Вход не завершён/, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продолжить с Google", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
