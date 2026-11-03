import { origin as qaOrigin } from "./helpers";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { headers, verifiedUser, jobDone } from "./helpers";

async function database() {
  const config = parseEnv(await readFile(".env.local", "utf8"));
  return new Pool({ connectionString: config.DATABASE_URL });
}
async function source(request: APIRequestContext, name: string) {
  const bytes = await readFile(`tests/fixtures/${name}`);
  const response = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: { name, mimeType: "application/octet-stream", buffer: bytes },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return { bytes, id: (await response.json()).id };
}

test("legacy unscanned source is private until a fresh scan publishes an immutable clean copy", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const data = await source(request, "ru-digital.pdf");
  const pool = await database();
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    const previous = (
      await pool.query(
        "UPDATE uploads SET scan_status='unscanned-development' WHERE id=$1 RETURNING object_key,checksum,owner_id",
        [data.id],
      )
    ).rows[0];
    const plan = randomUUID();
    await pool.query(
      "INSERT INTO plans(id,owner_id,file_id,title) VALUES($1,$2,$3,'Legacy scan QA')",
      [plan, previous.owner_id, data.id],
    );
    for (const response of [
      await request.get(`/api/uploads/${data.id}`),
      await request.head(`/api/uploads/${data.id}`),
      await request.get(`/api/uploads/${data.id}`, {
        headers: { Range: "bytes=0-15" },
      }),
      await request.get(`/api/ktp/${plan}/preview?page=1`),
    ])
      expect(response.status()).toBe(409);
    await verifiedUser(other);
    expect((await other.head(`/api/uploads/${data.id}`)).status()).toBe(404);
    const imported = await request.post("/api/ktp/imports", {
      headers,
      data: { uploadId: data.id, locale: "ru" },
    });
    expect(imported.status()).toBe(202);
    await jobDone(request, (await imported.json()).jobId);
    const scanned = (
      await pool.query(
        "SELECT scan_status,object_key,checksum FROM uploads WHERE id=$1",
        [data.id],
      )
    ).rows[0];
    expect(scanned.scan_status).toBe("clean");
    expect(scanned.object_key).not.toBe(previous.object_key);
    expect(scanned.checksum).toBe(previous.checksum);
    const download = await request.get(`/api/uploads/${data.id}`);
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(data.bytes);
    const preview = await request.get(`/api/ktp/${plan}/preview?page=1`);
    expect(preview.status(), await preview.text()).toBe(200);
    expect(preview.headers()["content-type"]).toContain("image/png");
  } finally {
    await pool.end();
    await other.dispose();
  }
});

test("a changed checksum cannot be promoted by rescanning a legacy source", async ({
  request,
}) => {
  await verifiedUser(request);
  const data = await source(request, "ru-table-1.docx");
  const pool = await database();
  try {
    const previous = (
      await pool.query(
        "UPDATE uploads SET scan_status='unscanned-development',checksum=$2 WHERE id=$1 RETURNING object_key",
        [data.id, "0".repeat(64)],
      )
    ).rows[0];
    const imported = await request.post("/api/ktp/imports", {
      headers,
      data: { uploadId: data.id, locale: "ru" },
    });
    expect(imported.status()).toBe(202);
    const job = (await imported.json()).jobId;
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/jobs/${job}`)).json()).status,
        { timeout: 45000 },
      )
      .toBe("failed");
    const failed = await (await request.get(`/api/jobs/${job}`)).json();
    expect(failed.error.code).toBe("FILE_INVALID");
    const upload = (
      await pool.query(
        "SELECT object_key,scan_status FROM uploads WHERE id=$1",
        [data.id],
      )
    ).rows[0];
    expect(upload).toEqual({
      object_key: previous.object_key,
      scan_status: "unscanned-development",
    });
    expect((await request.get(`/api/uploads/${data.id}`)).status()).toBe(409);
  } finally {
    await pool.end();
  }
});

test("structurally unsafe legacy bytes stay rejected after a fresh inspection", async ({
  request,
}) => {
  await verifiedUser(request);
  const bytes = Buffer.from("PK\x03\x04not a valid Office archive");
  const init = await request.post("/api/uploads/init", {
    headers,
    data: { name: "legacy.docx", bytes: bytes.length },
  });
  expect(init.status()).toBe(201);
  const signed = await init.json();
  expect(
    (
      await request.put(signed.url, {
        headers: { "Content-Type": signed.contentType },
        data: bytes,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/uploads/${signed.id}/complete`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(200);
  const pool = await database();
  try {
    await pool.query(
      "UPDATE uploads SET scan_status='unscanned-development',checksum=$2 WHERE id=$1",
      [signed.id, createHash("sha256").update(bytes).digest("hex")],
    );
    const imported = await request.post("/api/ktp/imports", {
      headers,
      data: { uploadId: signed.id, locale: "ru" },
    });
    expect(imported.status()).toBe(202);
    const job = (await imported.json()).jobId;
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/jobs/${job}`)).json()).status,
        { timeout: 45000 },
      )
      .toBe("failed");
    expect(
      (
        await pool.query("SELECT scan_status,status FROM uploads WHERE id=$1", [
          signed.id,
        ])
      ).rows[0],
    ).toEqual({ scan_status: "rejected", status: "rejected" });
    expect((await request.head(`/api/uploads/${signed.id}`)).status()).toBe(
      409,
    );
  } finally {
    await pool.end();
  }
});
