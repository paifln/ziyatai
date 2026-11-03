import { origin as qaOrigin } from "./helpers";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { headers, verifiedUser, approveGeneration, jobDone } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

async function pool() {
  return new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
}
async function fixture(request: APIRequestContext, database: Pool) {
  const bytes = await readFile("tests/fixtures/ru-table-1.docx");
  const upload = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: "Source check QA.docx",
        mimeType: "application/octet-stream",
        buffer: bytes,
      },
    },
  });
  expect(upload.status()).toBe(201);
  const file = (await upload.json()).id;
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const document = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  await approveGeneration(request, demo.id, document.revision);
  const plan = document.plan_id;
  await database.query("UPDATE plans SET file_id=$2 WHERE id=$1", [plan, file]);
  await database.query(
    "UPDATE uploads SET scan_status='unscanned-development' WHERE id=$1",
    [file],
  );
  return { plan, file, generation: demo.id, bytes };
}

test("parallel source checks are idempotent and preserve KTP revisions and teacher approval", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const database = await pool();
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    const f = await fixture(request, database);
    const before = await (await request.get(`/api/ktp/${f.plan}`)).json();
    expect(
      (await request.delete(`/api/ktp/${f.plan}/source`, { headers })).status(),
    ).toBe(405);
    expect(
      (await request.get(`/api/ktp/${f.plan}/source/extra`)).status(),
    ).toBe(404);
    expect(
      (
        await request.delete(`/api/ktp/${f.plan}/source/extra`, { headers })
      ).status(),
    ).toBe(404);
    const approved = await (
      await request.get(`/api/generations/${f.generation}`)
    ).json();
    const state = await (await request.get(`/api/ktp/${f.plan}/source`)).json();
    expect(state).toMatchObject({ available: false, canCheck: true });
    expect(JSON.stringify(state)).not.toMatch(/object_key|checksum|owner_id/);
    await verifiedUser(other);
    expect((await other.get(`/api/ktp/${f.plan}/source`)).status()).toBe(404);
    expect(
      (
        await other.post(`/api/ktp/${f.plan}/source`, {
          headers: { ...headers, "Idempotency-Key": randomUUID() },
          data: {},
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`/api/ktp/${f.plan}/source`, {
          headers: { "Idempotency-Key": randomUUID() },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const key = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        request.post(`/api/ktp/${f.plan}/source`, {
          headers: { ...headers, "Idempotency-Key": key },
          data: {},
        }),
      ),
    );
    const ids = [];
    for (const reply of replies) {
      expect(reply.status(), await reply.text()).toBe(202);
      ids.push((await reply.json()).jobId);
    }
    expect(new Set(ids).size).toBe(1);
    await jobDone(request, ids[0]);
    expect(await (await request.get(`/api/ktp/${f.plan}`)).json()).toEqual(
      before,
    );
    const after = await (
      await request.get(`/api/generations/${f.generation}`)
    ).json();
    expect(after.revision).toBe(approved.revision);
    expect(after.document).toEqual(approved.document);
    expect(after.reviewed_at).toBe(approved.reviewed_at);
    expect(
      (await (await request.get(`/api/ktp/${f.plan}/source`)).json()).available,
    ).toBe(true);
    expect(await (await request.get(`/api/uploads/${f.file}`)).body()).toEqual(
      f.bytes,
    );
    const replay = await request.post(`/api/ktp/${f.plan}/source`, {
      headers: { ...headers, "Idempotency-Key": key },
      data: {},
    });
    expect((await replay.json()).jobId).toBe(ids[0]);
    const jobs = await database.query(
      "SELECT count(*)::int AS count FROM jobs WHERE resource_id=$1 AND kind='scan'",
      [f.plan],
    );
    expect(jobs.rows[0].count).toBe(1);
  } finally {
    await database.end();
    await other.dispose();
  }
});

for (const lite of [false, true])
  test(`source check controls preserve unsaved lessons in ${lite ? "Lite" : "main"}`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    const database = await pool();
    try {
      const f = await fixture(request, database);
      const owner = (
        await database.query("SELECT owner_id FROM plans WHERE id=$1", [f.plan])
      ).rows[0].owner_id;
      const queued = randomUUID();
      await database.query(
        "INSERT INTO jobs(id,owner_id,kind,resource_id,payload,idempotency_key,available_at) VALUES($1,$2,'scan',$3,$4,$1::uuid::text,now()+interval '1 hour')",
        [queued, owner, f.plan, { uploadId: f.file }],
      );
      await page.context().addCookies((await request.storageState()).cookies);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.context().addCookies([
        {
          name: "ziyatai-locale",
          value: "ru",
          domain: new URL(qaOrigin).hostname,
          path: "/",
        },
      ]);
      await page.goto(lite ? "/lite/" : "/");
      if (lite)
        await page
          .getByRole("button", { name: "Открыть", exact: true })
          .first()
          .click();
      else
        await page
          .locator(".resource-text")
          .filter({ hasText: "DEMO" })
          .first()
          .click();
      const topic = page
        .getByLabel(lite ? "Тема урока" : "Тема урока 1", { exact: true })
        .first();
      await topic.fill("Моя несохранённая тема");
      await page
        .getByRole("button", { name: "Отменить проверку", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Проверить исходник", exact: true }),
      ).toBeVisible();
      await expect(topic).toHaveValue("Моя несохранённая тема");
      expect(
        (await new AxeBuilder({ page }).include(".source-access").analyze())
          .violations,
      ).toEqual([]);
      await page.locator(".source-access").screenshot({
        path: test.info().outputPath("source-access-light.png"),
      });
      if (lite) await page.locator("#theme-toggle").click();
      else
        await page
          .getByRole("button", { name: "Включить тёмную тему", exact: true })
          .click();
      expect(
        (await new AxeBuilder({ page }).include(".source-access").analyze())
          .violations,
      ).toEqual([]);
      await page.locator(".source-access").screenshot({
        path: test.info().outputPath("source-access-dark.png"),
      });
      expect(
        (await database.query("SELECT status FROM jobs WHERE id=$1", [queued]))
          .rows[0].status,
      ).toBe("cancelled");
      await page
        .getByRole("button", { name: "Проверить исходник", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await request.get(`/api/ktp/${f.plan}/source`)).json())
              .available,
          { timeout: 45000 },
        )
        .toBe(true);
      if (lite)
        await page
          .getByRole("button", {
            name: "Обновить состояние файла",
            exact: true,
          })
          .click();
      await expect(
        page.locator(`a[href='/api/uploads/${f.file}']`),
      ).toBeVisible();
      await expect(topic).toHaveValue("Моя несохранённая тема");
    } finally {
      await database.end();
    }
  });

test("a failed source check keeps saved lessons intact and offers reupload for damaged bytes", async ({
  request,
}) => {
  await verifiedUser(request);
  const database = await pool();
  try {
    const f = await fixture(request, database);
    const before = await (await request.get(`/api/ktp/${f.plan}`)).json();
    await database.query("UPDATE uploads SET checksum=$2 WHERE id=$1", [
      f.file,
      "0".repeat(64),
    ]);
    const created = await request.post(`/api/ktp/${f.plan}/source`, {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {},
    });
    expect(created.status()).toBe(202);
    const id = (await created.json()).jobId;
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/jobs/${id}`)).json()).status,
        { timeout: 45000 },
      )
      .toBe("failed");
    const state = await (await request.get(`/api/ktp/${f.plan}/source`)).json();
    expect(state).toMatchObject({
      available: false,
      canCheck: false,
      job: { error_code: "FILE_INVALID" },
    });
    expect(await (await request.get(`/api/ktp/${f.plan}`)).json()).toEqual(
      before,
    );
    expect((await request.head(`/api/uploads/${f.file}`)).status()).toBe(409);
  } finally {
    await database.end();
  }
});

test("deleting a KTP cancels its pending source check and closes source access", async ({
  request,
}) => {
  await verifiedUser(request);
  const database = await pool();
  try {
    const f = await fixture(request, database);
    const owner = (
      await database.query("SELECT owner_id FROM plans WHERE id=$1", [f.plan])
    ).rows[0].owner_id;
    const id = randomUUID();
    await database.query(
      "INSERT INTO jobs(id,owner_id,kind,resource_id,payload,idempotency_key,available_at) VALUES($1,$2,'scan',$3,$4,$1::uuid::text,now()+interval '1 hour')",
      [id, owner, f.plan, { uploadId: f.file }],
    );
    expect(
      (await request.delete(`/api/ktp/${f.plan}`, { headers })).status(),
    ).toBe(200);
    expect(
      (await database.query("SELECT status FROM jobs WHERE id=$1", [id]))
        .rows[0].status,
    ).toBe("cancelled");
    expect((await request.get(`/api/ktp/${f.plan}/source`)).status()).toBe(404);
    expect((await request.head(`/api/uploads/${f.file}`)).status()).toBe(404);
  } finally {
    await database.end();
  }
});

test("source-check hourly budget is shared across files and serialized for parallel starts", async ({
  request,
}) => {
  await verifiedUser(request);
  const database = await pool();
  try {
    const a = await fixture(request, database),
      b = await fixture(request, database);
    const owner = (
      await database.query("SELECT owner_id FROM plans WHERE id=$1", [a.plan])
    ).rows[0].owner_id;
    // Demo creation is idempotent per teacher; use a distinct plan/file pair.
    const separate = randomUUID();
    await database.query(
      "INSERT INTO plans(id,owner_id,file_id,title,status) VALUES($1,$2,$3,'Quota source QA','confirmed')",
      [separate, owner, a.file],
    );
    a.plan = separate;
    await database.query(
      "INSERT INTO jobs(id,owner_id,kind,resource_id,payload,idempotency_key,status) SELECT gen_random_uuid(),$1,'scan',$2,$3,'quota-'||g,'failed' FROM generate_series(1,4) g",
      [owner, a.plan, { uploadId: a.file }],
    );
    const responses = await Promise.all(
      [a, b].map((f) =>
        request.post(`/api/ktp/${f.plan}/source`, {
          headers: { ...headers, "Idempotency-Key": randomUUID() },
          data: {},
        }),
      ),
    );
    expect(responses.map((r) => r.status()).sort()).toEqual([202, 429]);
    const accepted = responses.find((r) => r.status() === 202)!;
    await jobDone(request, (await accepted.json()).jobId);
    expect(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM jobs WHERE owner_id=$1 AND kind='scan'",
          [owner],
        )
      ).rows[0].count,
    ).toBe(5);
  } finally {
    await database.end();
  }
});
