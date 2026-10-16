import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  verifiedUser,
  jobDone,
  emailLink,
  origin,
  headers,
  approveGeneration,
} from "./helpers";
test("all formats, review, versions, exports, private ACL and persistence", async ({
  page,
  request,
  playwright,
}) => {
  test.setTimeout(240000); // Includes server-enforced auth cooldown and serial OCR.
  const user = await verifiedUser(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Мои КТП" })).toBeVisible();
  await mkdir(".local/qa", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".local/qa/dashboard-1440.png",
    fullPage: true,
    animations: "disabled",
  });
  const planIds: string[] = [];
  for (const file of [
    "ru-table-1.docx",
    "kk-workbook-2.xlsx",
    "ru-legacy.xls",
    "ru-digital.pdf",
  ]) {
    const upload = await request.post("/api/uploads", {
      headers,
      multipart: {
        file: {
          name: file,
          mimeType: "application/octet-stream",
          buffer: await readFile(`tests/fixtures/${file}`),
        },
      },
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const uploaded = await upload.json();
    const imported = await request.post("/api/ktp/imports", {
      headers,
      data: {
        uploadId: uploaded.id,
        locale: file.startsWith("kk") ? "kk" : "ru",
      },
    });
    expect(imported.status(), await imported.text()).toBe(202);
    const result = await imported.json();
    await jobDone(request, result.jobId);
    const plan = await (await request.get(`/api/ktp/${result.id}`)).json();
    expect(plan.rows).toHaveLength(3);
    plan.rows[0].topic += " • исправлено";
    const codeOnly = JSON.parse(JSON.stringify(plan.rows));
    codeOnly[0].goals = "(7.3.2.1): / 7.3.2.2;";
    codeOnly[0].objectiveCodes = [];
    expect(
      (
        await request.post(`/api/ktp/${result.id}/confirm`, {
          headers,
          data: {
            revision: plan.revision,
            rows: codeOnly,
            grade: 7,
            schoolYear: "2026–2027",
          },
        })
      ).status(),
    ).toBe(422);
    const confirmed = await request.post(`/api/ktp/${result.id}/confirm`, {
      headers,
      data: {
        revision: plan.revision,
        rows: plan.rows,
        grade: 7,
        schoolYear: "2026–2027",
      },
    });
    expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
    const stale = await request.patch(`/api/ktp/${result.id}/rows`, {
      headers,
      data: {
        revision: plan.revision,
        rows: plan.rows,
        grade: 7,
        schoolYear: "2026–2027",
      },
    });
    expect(stale.status()).toBe(409);
    planIds.push(result.id);
  }
  const demo = await request.post("/api/demo", {
    headers,
    data: { locale: "kk" },
  });
  expect(demo.status(), await demo.text()).toBe(201);
  const { id: generationId } = await demo.json();
  const g = await (
    await request.get(`/api/generations/${generationId}`)
  ).json();
  expect(g.demo).toBe(true);
  const document = structuredClone(g.document);
  document.tasks[0].contentBlocks[0].text += " Ә Ғ Қ Ң Ө Ұ Ү Һ І";
  const saved = await request.patch(
    `/api/generations/${generationId}/document`,
    { headers, data: { revision: g.revision, document } },
  );
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const older = await (
    await request.get(`/api/generations/${generationId}?revision=1`)
  ).json();
  expect(older.document.tasks[0].contentBlocks[0].text).not.toContain(
    "Ә Ғ Қ Ң",
  );
  const exportIds: string[] = [];
  await approveGeneration(request, generationId, 2);
  for (const format of ["docx", "pdf"]) {
    const ex = await request.post("/api/exports", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        generationId,
        revision: 2,
        format,
        audience: "full",
        styles: {},
        teacherReviewed: true,
      },
    });
    expect(ex.status(), await ex.text()).toBe(202);
    const result = await ex.json();
    await jobDone(request, result.jobId);
    const download = await request.get(`/api/exports/${result.id}/download`);
    expect(download.ok(), await download.text()).toBeTruthy();
    await writeFile(`.local/qa/full.${format}`, await download.body());
    exportIds.push(result.id);
  }
  const exStudent = await request.post("/api/exports", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      teacherReviewed: true,
      generationId,
      revision: 2,
      format: "docx",
      audience: "student",
      styles: {},
    },
  });
  const student = await exStudent.json();
  await jobDone(request, student.jobId);
  await writeFile(
    ".local/qa/student.docx",
    await (await request.get(`/api/exports/${student.id}/download`)).body(),
  );
  const other = await playwright.request.newContext({ baseURL: origin });
  await verifiedUser(other, "Other Synthetic Teacher");
  for (const path of [
    `ktp/${planIds[0]}`,
    `generations/${generationId}`,
    `exports/${exportIds[0]}/download`,
  ])
    expect((await other.get(`/api/${path}`)).status()).toBe(404);
  expect(
    (
      await request.patch("/api/profile", {
        headers: { Origin: "http://evil.test" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/uploads", {
        headers,
        multipart: {
          file: {
            name: "bad.xlsx",
            mimeType: "application/octet-stream",
            buffer: Buffer.from("%PDF-1.7"),
          },
        },
      })
    ).status(),
  ).toBe(415);
  await request.post("/api/auth/sign-out", { headers, data: {} });
  expect((await request.get(`/api/generations/${generationId}`)).status()).toBe(
    401,
  );
  await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email: user.email, password: user.password },
  });
  await page.context().addCookies((await request.storageState()).cookies);
  expect(
    (await request.get(`/api/generations/${generationId}`)).ok(),
  ).toBeTruthy();
  expect((await (await request.get("/api/library")).json()).length).toBe(3);
  await page.reload();
  await page.getByRole("button", { name: "Мои КТП", exact: true }).click();
  await expect(
    page.getByText("ru-table-1.docx", { exact: true }),
  ).toBeVisible();
  await page.getByText("ru-table-1.docx", { exact: true }).click();
  await expect(page.getByLabel("Тема урока 1", { exact: true })).toHaveValue(
    /исправлено/,
  );
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `.local/qa/review-${width}.png`,
      animations: "disabled",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await other.dispose();
});
test("password reset uses delivered email and invalidates the old password", async ({
  request,
}) => {
  const user = await verifiedUser(request);
  const result = await request.post("/api/auth/request-password-reset", {
    headers,
    data: { email: user.email, redirectTo: origin + "/" },
  });
  expect(result.ok()).toBeTruthy();
  const url = await emailLink(request, user.email, "Восстановление");
  const followed = await request.get(url, { maxRedirects: 0 });
  const token = new URL(followed.headers().location).searchParams.get("token");
  const password = randomBytes(16).toString("hex");
  const reset = await request.post("/api/auth/reset-password", {
    headers,
    data: { token, newPassword: password },
  });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  expect((await request.get("/api/profile")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers,
        data: { email: user.email, password: user.password },
      })
    ).ok(),
  ).toBe(false);
  await expect
    .poll(
      async () => {
        const response = await request.post("/api/auth/sign-in/email", {
          headers,
          data: { email: user.email, password },
        });
        return response.status();
      },
      { timeout: 20000, intervals: [2000, 3000, 5000] },
    )
    .toBe(200);
});
