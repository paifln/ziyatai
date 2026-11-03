import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { verifiedUser, headers, jobDone } from "./helpers";

test("active PDF content is rejected through multipart and stays quarantined after a signed upload", async ({
  request,
}) => {
  await verifiedUser(request);
  const bytes = await readFile("tests/fixtures/active-content.pdf");
  const multipart = await request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: "active-content.pdf",
        mimeType: "application/pdf",
        buffer: bytes,
      },
    },
  });
  expect(multipart.status(), await multipart.text()).toBe(422);
  expect((await multipart.json()).code).toBe("FILE_INVALID");
  const initialized = await request.post("/api/uploads/init", {
    headers,
    data: { name: "active-content.pdf", bytes: bytes.length },
  });
  expect(initialized.status(), await initialized.text()).toBe(201);
  const upload = await initialized.json();
  expect(
    (
      await request.put(upload.url, {
        headers: { "Content-Type": upload.contentType },
        data: bytes,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/uploads/${upload.id}/complete`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const imported = await request.post("/api/ktp/imports", {
    headers,
    data: { uploadId: upload.id, locale: "ru" },
  });
  expect(imported.status(), await imported.text()).toBe(202);
  const jobId = (await imported.json()).jobId;
  let job: any;
  await expect
    .poll(
      async () => {
        job = await (await request.get(`/api/jobs/${jobId}`)).json();
        return job.status;
      },
      { timeout: 30000 },
    )
    .toBe("failed");
  expect(job.error.code).toBe("FILE_INVALID");
  expect((await request.get(`/api/uploads/${upload.id}`)).status()).toBe(409);
  await writeFile(
    ".local/reports/passive-pdf.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        source:
          "synthetic PDF with inert void(0) JavaScript name entry; no script was executed",
        multipartRejected: true,
        signedUploadRejectedBeforePublishing: true,
        downloadDenied: true,
        environment: "local compiled application and isolated renderer",
      },
      null,
      2,
    ) + "\n",
  );
});

test("signed uploads bind size and owner, quarantine untrusted bytes and publish a separate scanned object", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const bytes = await readFile("tests/fixtures/ru-table-1.docx");
  const init = await request.post("/api/uploads/init", {
    headers,
    data: { name: "plan.docx", bytes: bytes.length },
  });
  expect(init.status()).toBe(201);
  const signed = await init.json();
  expect(new URL(signed.url).searchParams.get("X-Amz-SignedHeaders")).toContain(
    "content-length",
  );
  expect((await request.get(`/api/uploads/${signed.id}`)).status()).toBe(409);
  expect(
    (
      await request.post("/api/ktp/imports", {
        headers,
        data: { uploadId: signed.id, locale: "ru" },
      })
    ).status(),
  ).toBe(409);
  const wrong = await request.put(signed.url, {
    headers: { "Content-Type": signed.contentType },
    data: Buffer.from("wrong size"),
  });
  expect(wrong.ok()).toBe(false);
  const stored = await request.put(signed.url, {
    headers: { "Content-Type": signed.contentType },
    data: bytes,
  });
  expect(stored.ok(), await stored.text()).toBe(true);
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  await verifiedUser(other);
  expect(
    (
      await other.post(`/api/uploads/${signed.id}/complete`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/uploads/${signed.id}/complete`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`/api/uploads/${signed.id}/complete`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(200);
  expect((await request.get(`/api/uploads/${signed.id}`)).status()).toBe(409);
  const imported = await (
    await request.post("/api/ktp/imports", {
      headers,
      data: { uploadId: signed.id, locale: "ru" },
    })
  ).json();
  await jobDone(request, imported.jobId);
  const original = await request.get(`/api/uploads/${signed.id}`);
  expect(original.ok()).toBe(true);
  expect(await original.body()).toEqual(bytes);
  // Reusing a still-valid signed URL cannot alter the clean source after scanning.
  const replacement = Buffer.alloc(bytes.length, 65);
  expect(
    (
      await request.put(signed.url, {
        headers: { "Content-Type": signed.contentType },
        data: replacement,
      })
    ).ok(),
  ).toBe(true);
  expect(await (await request.get(`/api/uploads/${signed.id}`)).body()).toEqual(
    bytes,
  );
  expect((await other.get(`/api/uploads/${signed.id}`)).status()).toBe(404);
  await other.dispose();
});

test("a fake document uploaded through a valid signature never becomes downloadable", async ({
  request,
}) => {
  await verifiedUser(request);
  const bytes = Buffer.from("not an OOXML file");
  const init = await (
    await request.post("/api/uploads/init", {
      headers,
      data: { name: "fake.docx", bytes: bytes.length },
    })
  ).json();
  expect(
    (
      await request.put(init.url, {
        headers: { "Content-Type": init.contentType },
        data: bytes,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/uploads/${init.id}/complete`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const imported = await (
    await request.post("/api/ktp/imports", {
      headers,
      data: { uploadId: init.id, locale: "ru" },
    })
  ).json();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/jobs/${imported.jobId}`)).json())
          .status,
      { timeout: 30000 },
    )
    .toBe("failed");
  expect((await request.get(`/api/uploads/${init.id}`)).status()).toBe(409);
});
