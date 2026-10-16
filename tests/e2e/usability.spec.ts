import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifiedUser, headers } from "./helpers";

test("forms explain missing values without browser validation popups and can reveal passwords", async ({
  page,
}) => {
  let authPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/auth/"))
      authPosts++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator(".form-errors[role=alert]")).toContainText(
    "Проверим несколько деталей",
  );
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  expect(
    await page
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.noValidate),
  ).toBe(true);
  expect(authPosts).toBe(0);
  await page.getByLabel("Email", { exact: true }).fill("teacher@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
  await page
    .getByRole("button", { name: "Показать пароль", exact: true })
    .click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Скрыть пароль", exact: true })
    .click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page.getByLabel("Имя", { exact: true }).fill("Учитель");
  await page
    .getByLabel("Ваш предмет", { exact: true })
    .selectOption("mathematics");
  await page.getByLabel("Пароль", { exact: true }).fill("short");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.locator(".form-errors[role=alert]")).toContainText(
    "не менее 12",
  );
  expect(authPosts).toBe(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("the lesson sample is keyboard accessible and language changes preserve the form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.getByRole("tab", { name: "Лёгкий", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Средний", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Посмотреть решение", exact: true })
    .click();
  await expect(page.locator("#sample-answer")).toContainText("18");
  await page.getByLabel("Email", { exact: true }).fill("teacher@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("preserve-this-value");
  await page.getByRole("button", { name: "ҚАЗ", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "teacher@example.test",
  );
  await expect(page.getByLabel("Құпиясөз", { exact: true })).toHaveValue(
    "preserve-this-value",
  );
});

test("file picker validates immediately, supports replacement and removal, and fits small screens", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByRole("button", { name: "Загрузить КТП", exact: true })
    .first()
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "document.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("test"),
  });
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "Этот формат не подходит",
  );
  await expect(
    page.getByRole("button", { name: "Извлечь строки", exact: true }),
  ).toBeDisabled();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Выбрать файл", exact: true }).click();
  await (await chooser).setFiles("tests/fixtures/ru-legacy.xls");
  await expect(page.locator(".selected-file")).toContainText("ru-legacy.xls");
  await expect(
    page.getByRole("button", { name: "Извлечь строки", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Убрать файл", exact: true }).click();
  await expect(page.locator(".selected-file")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Выбрать файл", exact: true }),
  ).toBeFocused();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/morning-upload-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("plan filters have an empty result state and deletion requires the custom dialog", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.getByRole("button", { name: /^Требуется проверка/ }).click();
  await expect(
    page.getByRole("heading", { name: "Таких планов пока нет" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await expect(page.locator(".resource-row")).toHaveCount(1);
  await page.getByLabel("Фильтр по классу").selectOption("5");
  await expect(
    page.getByRole("heading", { name: "Таких планов пока нет" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await request.get(`/api/ktp/${demo.planId}`)).status()).toBe(200);
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect
    .poll(async () => (await request.get(`/api/ktp/${demo.planId}`)).status())
    .toBe(404);
});

test("auth rejects excessive bodies before authentication and publishes isolation headers", async ({
  request,
}) => {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: JSON.stringify({ email: "x".repeat(70 * 1024) }),
  });
  expect(response.status()).toBe(413);
  expect((await response.json()).code).toBe("FILE_SIZE");
  const page = await request.get("/");
  expect(page.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(page.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(page.headers()["content-security-policy"]).toContain(
    "object-src 'none'",
  );
});

test("each page receives a fresh CSP nonce and an untrusted inline script cannot run", async ({
  page,
  request,
}) => {
  const first = await request.get("/", {
    headers: {
      "x-nonce": "attacker-controlled-value",
      "Content-Security-Policy": "script-src * 'unsafe-inline'",
    },
  });
  const second = await request.get("/");
  const nonce = (response: typeof first) =>
    response.headers()["content-security-policy"].match(/'nonce-([^']+)'/)?.[1];
  expect(nonce(first)).toBeTruthy();
  expect(nonce(first)).not.toBe(nonce(second));
  expect(nonce(first)).not.toBe("attacker-controlled-value");
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect(
    first
      .headers()
      ["content-security-policy"].split(";")
      .find((part) => part.includes("script-src")),
  ).not.toContain("unsafe-inline");
  // Inject untrusted markup into a real response. CDP evaluation is privileged
  // and is not a faithful test of the browser's HTML parser CSP boundary.
  await page.addInitScript(() => {
    (window as unknown as { cspViolations: string[] }).cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { cspViolations: string[] }).cspViolations.push(
        `${event.effectiveDirective}:${event.blockedURI}`,
      );
    });
  });
  await page.route("http://localhost:3000/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "</head>",
      `<script>document.documentElement.dataset.untrustedScript = 'executed'</script></head>`,
    );
    await route.fulfill({ response, body });
  });
  await page.goto("/");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { cspViolations: string[] }).cspViolations,
      ),
    )
    .toContain("script-src-elem:inline");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-untrusted-script",
    "executed",
  );
});

test("Lite uses custom field errors, a working password reveal and persistent legal links", async ({
  page,
}) => {
  await page.goto("/lite/");
  await page.getByRole("button", { name: "Русский", exact: true }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator(".field-error")).toHaveCount(2);
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
  await page
    .getByRole("button", { name: "Показать пароль", exact: true })
    .click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await expect(page.locator("footer a[href='/privacy/']")).toBeVisible();
  await expect(page.locator("footer a[href='/terms/']")).toBeVisible();
  await expect(page.locator("footer a[href='/cookies/']")).toBeVisible();
});

test("profile preserves unsaved changes and can revoke other devices without signing out this one", async ({
  page,
  request,
  playwright,
}) => {
  const user = await verifiedUser(request);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  try {
    let signedIn = await other.post("/api/auth/sign-in/email", {
      headers,
      data: user,
    });
    if (signedIn.status() === 429) {
      await expect
        .poll(
          async () => {
            signedIn = await other.post("/api/auth/sign-in/email", {
              headers,
              data: user,
            });
            return signedIn.status();
          },
          { timeout: 70000, intervals: [5000] },
        )
        .toBe(200);
    }
    expect(signedIn.status()).toBe(200);
    expect((await other.get("/api/profile")).status()).toBe(200);
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/");
    await page.getByRole("button", { name: "РУС", exact: true }).click();
    await page.getByRole("button", { name: "Профиль", exact: true }).click();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByLabel("Имя", { exact: true }).fill("Несохранённое имя");
    await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(page.getByLabel("Имя", { exact: true })).toHaveValue(
      "Несохранённое имя",
    );
    await page
      .getByRole("button", { name: "Выйти на других устройствах", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Другие сеансы завершены" }),
    ).toBeVisible();
    expect((await page.request.get("/api/profile")).status()).toBe(200);
    expect((await other.get("/api/profile")).status()).toBe(401);
  } finally {
    await other.dispose();
  }
});
