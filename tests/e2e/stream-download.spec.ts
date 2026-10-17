import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { verifiedUser, headers, approveGeneration, jobDone } from "./helpers";

async function source(request: Parameters<typeof verifiedUser>[0]) {
  const bytes = await readFile("tests/fixtures/ru-table-1.docx");
  const response = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: "План — қазақ тілі.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: bytes,
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return { bytes, id: (await response.json()).id };
}

test("source downloads expose progress metadata, support HEAD and resume exact byte ranges", async ({
  request,
}) => {
  await verifiedUser(request);
  const data = await source(request),
    url = `/api/uploads/${data.id}`;
  const full = await request.get(url);
  expect(full.status()).toBe(200);
  expect(await full.body()).toEqual(data.bytes);
  expect(full.headers()["content-length"]).toBe(String(data.bytes.length));
  expect(full.headers()["cache-control"]).toBe("private, no-store");
  expect(full.headers()["accept-ranges"]).toBe("bytes");
  expect(full.headers()["content-disposition"]).toContain("filename*=UTF-8''");
  const head = await request.head(url);
  expect(head.status()).toBe(200);
  expect((await head.body()).length).toBe(0);
  expect(head.headers()["content-length"]).toBe(String(data.bytes.length));
  const first = await request.get(url, { headers: { Range: "bytes=0-31" } });
  expect(first.status()).toBe(206);
  expect(first.headers()["content-range"]).toBe(
    `bytes 0-31/${data.bytes.length}`,
  );
  expect(await first.body()).toEqual(data.bytes.subarray(0, 32));
  const tail = await request.get(url, {
    headers: { Range: "bytes=-16", "If-Range": full.headers().etag },
  });
  expect(tail.status()).toBe(206);
  expect(await tail.body()).toEqual(data.bytes.subarray(-16));
  const invalid = await request.get(url, {
    headers: { Range: `bytes=${data.bytes.length + 1}-` },
  });
  expect(invalid.status()).toBe(416);
  expect(invalid.headers()["content-range"]).toBe(
    `bytes */${data.bytes.length}`,
  );
});

test("HEAD and range requests cannot bypass ownership, quarantine or completion checks", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const data = await source(request),
    url = `/api/uploads/${data.id}`;
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  try {
    await verifiedUser(other);
    for (const response of [
      await other.head(url),
      await other.get(url, { headers: { Range: "bytes=0-10" } }),
    ]) {
      expect(response.status()).toBe(404);
      expect(response.headers()["content-range"]).toBeUndefined();
      expect(response.headers()["content-disposition"]).toBeUndefined();
    }
    const init = await request.post("/api/uploads/init", {
      headers,
      data: { name: "pending.docx", bytes: data.bytes.length },
    });
    expect(init.status()).toBe(201);
    const pending = (await init.json()).id;
    expect((await request.head(`/api/uploads/${pending}`)).status()).toBe(409);
    expect(
      (
        await request.get(`/api/uploads/${pending}`, {
          headers: { Range: "bytes=0-10" },
        })
      ).status(),
    ).toBe(409);
    await pool.query("UPDATE uploads SET scan_status='infected' WHERE id=$1", [
      data.id,
    ]);
    expect((await request.head(url)).status()).toBe(409);
    expect(
      (await request.get(url, { headers: { Range: "bytes=0-10" } })).status(),
    ).toBe(409);
  } finally {
    await pool.query("UPDATE uploads SET scan_status='clean' WHERE id=$1", [
      data.id,
    ]);
    await pool.end();
    await other.dispose();
  }
});

test("reviewed exports stream exact bytes and HEAD cannot bypass teacher approval", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const generation = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  await approveGeneration(request, demo.id, generation.revision);
  const created = await request.post("/api/exports", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      generationId: demo.id,
      revision: generation.revision,
      format: "docx",
      audience: "student",
      teacherReviewed: true,
      styles: {},
    },
  });
  expect(created.status(), await created.text()).toBe(202);
  const document = await created.json();
  await jobDone(request, document.jobId);
  const url = `/api/exports/${document.id}/download`;
  const full = await request.get(url),
    bytes = await full.body();
  expect(full.status()).toBe(200);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  const head = await request.head(url);
  expect(head.status()).toBe(200);
  expect(head.headers()["content-length"]).toBe(String(bytes.length));
  const part = await request.get(url, { headers: { Range: "bytes=0-127" } });
  expect(part.status()).toBe(206);
  expect(await part.body()).toEqual(bytes.subarray(0, 128));
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  try {
    await verifiedUser(other);
    expect((await other.head(url)).status()).toBe(404);
    await pool.query("UPDATE exports SET teacher_reviewed=false WHERE id=$1", [
      document.id,
    ]);
    expect((await request.head(url)).status()).toBe(422);
    expect(
      (await request.get(url, { headers: { Range: "bytes=0-1" } })).status(),
    ).toBe(422);
  } finally {
    await pool.query("UPDATE exports SET teacher_reviewed=true WHERE id=$1", [
      document.id,
    ]);
    await pool.end();
    await other.dispose();
  }
});
