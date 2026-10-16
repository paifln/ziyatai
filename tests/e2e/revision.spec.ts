import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { emailCode, verifiedUser, headers, jobDone } from "./helpers";

test("registration verifies a one-time email code and stores the selected subject", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  async function submitCode(expected: number) {
    await expect
      .poll(
        async () => {
          const response = page.waitForResponse((r) =>
            r.url().endsWith("/api/auth/email-otp/verify-email"),
          );
          await page
            .getByRole("button", { name: "Подтвердить почту", exact: true })
            .click();
          return (await response).status();
        },
        { timeout: 75000, intervals: [5000] },
      )
      .toBe(expected);
  }
  const email = `otp-${randomBytes(6).toString("hex")}@example.test`;
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page.getByLabel("Имя", { exact: true }).fill("Учитель биологии");
  await page.getByLabel("Ваш предмет", { exact: true }).selectOption("biology");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(randomBytes(16).toString("hex"));
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Проверьте почту" }),
  ).toBeVisible();
  const otp = await emailCode(request, email);
  const wrong = String((Number(otp) + 1) % 1000000).padStart(6, "0");
  await page.getByLabel("Код из письма").fill(wrong);
  await submitCode(400);
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "Код неверный",
  );
  await page.getByLabel("Код из письма").fill(otp);
  await submitCode(200);
  await expect(page.getByRole("heading", { name: "Мои КТП" })).toBeVisible();
  const profile = await (await page.request.get("/api/profile")).json();
  expect(profile.teachingSubject).toBe("biology");
  await expect
    .poll(
      async () =>
        (
          await request.post("/api/auth/email-otp/verify-email", {
            headers,
            data: { email, otp },
          })
        ).status(),
      { timeout: 75000, intervals: [5000] },
    )
    .toBe(400);
  await expect(
    page.getByRole("button", { name: "Обзор", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await expect(page.locator("#profile-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#profile-menu")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Свернуть панель", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page.reload();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page
    .getByRole("button", { name: "Развернуть панель", exact: true })
    .click();
  await page.screenshot({
    path: ".local/qa/revision-workspace.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("owner supplied workbook retains every sheet and can be separated by class", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.QA_KTP_PATH,
    "Private owner workbook is optional and never committed",
  );
  test.setTimeout(240000);
  const path = process.env.QA_KTP_PATH!;
  await verifiedUser(request);
  const upload = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: basename(path),
        mimeType: "application/vnd.ms-excel",
        buffer: await readFile(path),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const imported = await request.post("/api/ktp/imports", {
    headers,
    data: {
      uploadId: (await upload.json()).id,
      locale: "ru",
      includeHidden: false,
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const data = await imported.json();
  await jobDone(request, data.jobId);
  const plan = await (await request.get("/api/ktp/" + data.id)).json();
  expect(plan.rows).toHaveLength(426);
  expect(new Set(plan.rows.map((r: any) => r.source.sheet)).size).toBe(11);
  expect(plan.rows.filter((r: any) => !r.goals)).toHaveLength(8);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page
    .locator(".resource-text")
    .filter({ hasText: basename(path) })
    .click();
  await page
    .getByLabel("Лист / класс", { exact: true })
    .selectOption("1 класс");
  await page
    .getByRole("button", { name: "Работать только с этим листом", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  await expect(page.getByLabel("Класс", { exact: true })).toHaveValue("1");
  await page
    .getByRole("button", { name: "Подтвердить КТП", exact: true })
    .click();
  await expect(page.getByText("Подтверждено", { exact: true })).toBeVisible();
  const selected = await (await request.get("/api/ktp/" + data.id)).json();
  expect(selected.rows).toHaveLength(17);
  expect(selected.grade).toBe(1);
});

test("upload can be cancelled during a stalled transfer", async ({
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
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/ru-table-1.docx");
  let uploading = false;
  await page.route("**/api/uploads", async (route) => {
    uploading = true;
    await new Promise((r) => setTimeout(r, 3000));
    await route.abort();
  });
  await page
    .getByRole("button", { name: "Извлечь строки", exact: true })
    .click();
  await expect.poll(() => uploading).toBe(true);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Мои КТП" })).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
});
