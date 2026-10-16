import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser, jobDone } from "./helpers";

test("export progress resumes polling after a cancelled job is retried (controlled job responses)", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const approved = await request.post(`/api/generations/${demo.id}/approve`, {
    headers,
    data: { revision: 1, teacherReviewed: true },
  });
  expect(approved.ok()).toBe(true);
  const exportId = randomUUID(),
    jobId = randomUUID();
  let status = "queued",
    reads = 0;
  await page.route("**/api/exports", (route) =>
    route.fulfill({ status: 202, json: { id: exportId, jobId } }),
  );
  await page.route(`**/api/jobs/${jobId}`, (route) => {
    reads++;
    return route.fulfill({
      json: {
        id: jobId,
        kind: "export",
        status,
        stage: status === "succeeded" ? "done" : status,
        attempt: 1,
        cancelRequested: status === "cancelled",
        result: status === "succeeded" ? { exportId } : null,
      },
    });
  });
  await page.route(`**/api/jobs/${jobId}/cancel`, (route) => {
    status = "cancelled";
    return route.fulfill({ json: { cancelRequested: true } });
  });
  await page.route(`**/api/jobs/${jobId}/retry`, (route) => {
    status = "queued";
    return route.fulfill({ status: 202, json: { jobId } });
  });
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/?generation=${demo.id}`);
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.getByRole("button", { name: "DOCX", exact: true }).click();
  const progress = page.locator(".export-progress");
  await progress.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(progress.getByText("Отменено", { exact: true })).toBeVisible();
  const readsBeforeRetry = reads;
  await progress
    .getByRole("button", { name: "Повторить", exact: true })
    .click();
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRetry);
  status = "succeeded";
  const download = progress.getByRole("link", { name: "Скачать", exact: true });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute(
    "href",
    `/api/exports/${exportId}/download`,
  );
});

test("guest introduction and both themes stay accessible on phones, tablets and desktops", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("landing-hero"); // Public introduction is available before hydration.
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Ваш план",
  );
  await page
    .getByRole("combobox", { name: "Предмет примера", exact: true })
    .selectOption("history");
  await page
    .getByRole("button", { name: "C · Рассуждение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Посмотреть ответ", exact: true })
    .click();
  await expect(page.locator("#sample-answer")).toContainText("географическими");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("ziyatai-theme", value);
        document.documentElement.setAttribute("data-theme", value);
      }, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: `.local/qa/guest-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Включить светлую тему", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Войти", exact: false }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.goto("/signup");
  await expect(page.getByLabel("Ваш предмет", { exact: true })).toBeVisible();
});

test("bulk date skip spans filtered sheets and pages, can be undone, and persists", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = Array.from({ length: 53 }, (_, i) => ({
    ...plan.rows[0],
    id: randomUUID(),
    sourceOrder: i + 1,
    topic: `Урок ${i + 1}`,
    dateRaw: "01.09.2026",
    dateSkipped: false,
    source: { ...plan.rows[0].source, sheet: i < 25 ? "6А" : "6Б" },
  }));
  const saved = await request.patch(`/api/ktp/${plan.id}/rows`, {
    headers,
    data: { revision: plan.revision, rows, grade: 6, schoolYear: "2026–2027" },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  await page
    .getByRole("combobox", { name: "Лист / класс", exact: true })
    .selectOption("6А");
  await page
    .getByLabel("Тема урока 1", { exact: true })
    .fill("Сохранить эту правку");
  await page
    .getByRole("button", { name: "Пропустить все даты", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  await expect(
    page.getByLabel("Дата или диапазон 1", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Вернуть даты", exact: true }).click();
  await expect(
    page.getByLabel("Дата или диапазон 1", { exact: true }),
  ).toHaveValue("01.09.2026");
  await expect(page.getByLabel("Тема урока 1", { exact: true })).toHaveValue(
    "Сохранить эту правку",
  );
  await page
    .getByRole("button", { name: "Пропустить все даты", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(async () =>
      (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows.every(
        (r: any) =>
          r.dateSkipped &&
          !r.dateRaw &&
          !r.dateStart &&
          !r.dateEnd &&
          !r.warnings.some((w: string) => w.includes("date")),
      ),
    )
    .toBe(true);
  const reread = await (await request.get(`/api/ktp/${plan.id}`)).json();
  expect(reread.rows).toHaveLength(53);
  expect(reread.rows[0].topic).toBe("Сохранить эту правку");
  await page.reload();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  await expect(
    page.getByLabel("Дата или диапазон 1", { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Без даты · изменить", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Дата или диапазон 1", { exact: true })
    .fill("02.09.2026");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows[0]
          .dateStart,
    )
    .toBe("2026-09-02");
});

test("teacher approval is required on the server and belongs only to the reviewed revision", async ({
  page,
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const url = `/api/generations/${demo.id}`;
  const initial = await (await request.get(url)).json();
  const exportData = {
    generationId: demo.id,
    revision: initial.revision,
    format: process.env.QA_PDF_RENDER === "1" ? "pdf" : "docx",
    audience: "student",
    styles: {},
    teacherReviewed: true,
  };
  for (const format of ["docx", "pdf"]) {
    const unapproved = await request.post("/api/exports", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: { ...exportData, format },
    });
    expect(unapproved.status()).toBe(422);
    expect((await unapproved.json()).code).toBe("REVIEW_REQUIRED");
  }
  const stranger = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  await verifiedUser(stranger);
  expect(
    (
      await stranger.post(`http://localhost:3000${url}/approve`, {
        headers,
        data: { revision: initial.revision, teacherReviewed: true },
      })
    ).status(),
  ).toBe(404);
  await stranger.dispose();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/?generation=${demo.id}`);
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await expect(page.locator(".task-review-card")).toHaveCount(9);
  await expect(
    page.getByRole("button", { name: "Одобрить задания", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Я проверил(а) задания, ответы и критерии", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Одобрить задания", exact: true })
    .click();
  await expect(
    page.getByText("Одобрено учителем", { exact: true }),
  ).toBeVisible();
  const approved = await (await request.get(url)).json();
  expect(approved.reviewed_at).toBeTruthy();
  await page.reload();
  await expect(
    page.getByText("Одобрено учителем", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toBeEnabled();
  const exported = await request.post("/api/exports", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: exportData,
  });
  expect(exported.status(), await exported.text()).toBe(202);
  const pdf = await exported.json();
  await jobDone(request, pdf.jobId);
  const download = await request.get(`/api/exports/${pdf.id}/download`);
  expect(download.ok()).toBe(true);
  const bytes = await download.body();
  expect(
    bytes.subarray(0, exportData.format === "pdf" ? 5 : 2).toString(),
  ).toBe(exportData.format === "pdf" ? "%PDF-" : "PK");
  const document = structuredClone(approved.document);
  document.tasks[0].contentBlocks[0].text += " Проверьте свой ответ.";
  const edit = await request.patch(`${url}/document`, {
    headers,
    data: { revision: approved.revision, document },
  });
  expect(edit.ok(), await edit.text()).toBe(true);
  const changed = await (await request.get(url)).json();
  expect(changed.reviewed_at).toBeNull();
  expect(changed.status).toBe("needs_review");
  expect(
    (
      await request.post(`${url}/approve`, {
        headers,
        data: { revision: approved.revision, teacherReviewed: true },
      })
    ).status(),
  ).toBe(409);
  const blocked = await request.post("/api/exports", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { ...exportData, revision: changed.revision },
  });
  expect(blocked.status()).toBe(422);
  // The previously approved printed snapshot remains valid and private.
  expect((await request.get(`/api/exports/${pdf.id}/download`)).ok()).toBe(
    true,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Одобрить задания", exact: true }),
  ).toBeDisabled();
});
