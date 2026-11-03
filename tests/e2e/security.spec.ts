import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  verifiedUser,
  jobDone,
  headers,
  approveGeneration,
  origin,
} from "./helpers";
import { request as httpRequest } from "node:http";

test("chunked JSON is bounded and teacher review cannot bypass invalid scoring", async ({
  request,
}) => {
  await verifiedUser(request);
  const cookies = (await request.storageState()).cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const status = await new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest(
      new URL("/api/exports", origin),
      {
        method: "POST",
        headers: {
          ...headers,
          Cookie: cookies,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );
    outgoing.on("error", reject);
    outgoing.write('{"large":"');
    for (let i = 0; i < 9; i++) outgoing.write("a".repeat(256 * 1024));
    outgoing.end('"}');
  });
  expect(status).toBe(413);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const current = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  const task = current.document.tasks[0];
  task.points++;
  const edited = await request.patch(
    `/api/generations/${demo.id}/tasks/${task.id}`,
    { headers, data: { revision: current.revision, task } },
  );
  expect(edited.ok()).toBe(true);
  const updated = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  const approval = await request.post(`/api/generations/${demo.id}/approve`, {
    headers,
    data: { revision: updated.revision, teacherReviewed: true },
  });
  expect(approval.status()).toBe(422);
  expect((await approval.json()).code).toBe("REVIEW_REQUIRED");
  const rejected = await request.post("/api/exports", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      generationId: demo.id,
      revision: updated.revision,
      format: "docx",
      audience: "full",
      styles: {},
      teacherReviewed: true,
    },
  });
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).code).toBe("REVIEW_REQUIRED");
});
test("negative uploads, idempotent exports, cancellation and deletion revoke access", async ({
  request,
}) => {
  await verifiedUser(request);
  for (const file of [
    "zip-bomb.docx",
    "external-link.docx",
    "encrypted.pdf",
    "corrupt.pdf",
  ]) {
    const response = await request.post("/api/uploads", {
      headers,
      multipart: {
        file: {
          name: file,
          mimeType: "application/octet-stream",
          buffer: await readFile(`tests/fixtures/${file}`),
        },
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  }
  const g = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const key = randomUUID();
  await approveGeneration(request, g.id, 1);
  const data = {
    teacherReviewed: true,
    generationId: g.id,
    revision: 1,
    format: "docx",
    audience: "student",
    styles: {},
  };
  const [a, b] = await Promise.all([
    request.post("/api/exports", {
      headers: { ...headers, "Idempotency-Key": key },
      data,
    }),
    request.post("/api/exports", {
      headers: { ...headers, "Idempotency-Key": key },
      data,
    }),
  ]);
  const first = await a.json(),
    second = await b.json();
  expect(first.id).toBe(second.id);
  expect(first.jobId).toBe(second.jobId);
  await jobDone(request, first.jobId);
  expect((await request.get(`/api/exports/${first.id}/download`)).ok()).toBe(
    true,
  );
  expect(
    (await request.delete(`/api/generations/${g.id}`, { headers })).ok(),
  ).toBe(true);
  expect(
    (await request.get(`/api/exports/${first.id}/download`)).status(),
  ).toBe(404);
  expect((await request.get(`/api/generations/${g.id}`)).status()).toBe(404);
  expect((await request.delete("/api/account", { headers })).ok()).toBe(true);
  expect((await request.get("/api/profile")).status()).toBe(401);
});
test("scanned and mixed PDFs preserve page provenance and flag OCR", async ({
  request,
}) => {
  await verifiedUser(request);
  for (const file of ["kk-scan.pdf", "ru-mixed.pdf"]) {
    const u = await request.post("/api/uploads", {
      headers,
      multipart: {
        file: {
          name: file,
          mimeType: "application/pdf",
          buffer: await readFile(`tests/fixtures/${file}`),
        },
      },
    });
    expect(u.status()).toBe(201);
    const id = (await u.json()).id;
    const importResponse = await request.post("/api/ktp/imports", {
      headers,
      data: { uploadId: id, locale: file.startsWith("kk") ? "kk" : "ru" },
    });
    const imported = await importResponse.json();
    await jobDone(request, imported.jobId);
    const plan = await (await request.get(`/api/ktp/${imported.id}`)).json();
    const preview = await request.get(`/api/ktp/${imported.id}/preview?page=1`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toBe("image/png");
    expect(plan.rows.length).toBe(file.includes("mixed") ? 6 : 3);
    expect(
      plan.rows.some(
        (r: any) =>
          r.source.method === "ocr" &&
          r.warnings.includes("ocr_requires_review"),
      ),
    ).toBe(true);
    if (file.includes("mixed")) {
      expect(
        plan.rows.filter((r: any) => r.source.method === "digital"),
      ).toHaveLength(3);
      expect(
        plan.rows.filter((r: any) => r.source.method === "ocr"),
      ).toHaveLength(3);
    }
  }
});
