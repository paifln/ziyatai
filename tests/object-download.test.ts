import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const fixture = vi.hoisted(() => ({ endpoint: "" }));
vi.mock("../apps/web/lib/env", () => ({
  env: () => ({
    STORAGE_ENDPOINT: fixture.endpoint,
    STORAGE_REGION: "test",
    STORAGE_FORCE_PATH_STYLE: "true",
    STORAGE_ACCESS_KEY: "fixture-access",
    STORAGE_SECRET_KEY: "fixture-secret",
    STORAGE_BUCKET: "fixture",
    MAX_UPLOAD_MB: 25,
  }),
}));
import { objectDownload } from "../apps/web/lib/object-download";
import { getObject, openObject } from "../apps/web/lib/storage";

const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
const calls: { method: string; range?: string }[] = [];
let cancelled = 0,
  produced = 0;
const server = createServer(async (req, res) => {
  calls.push({ method: req.method!, range: req.headers.range });
  res.setHeader("ETag", '"fixture-v1"');
  res.setHeader("Last-Modified", "Thu, 01 Oct 2026 10:00:00 GMT");
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", bytes.length);
    res.end();
    return;
  }
  if (req.url!.includes("/stream") || req.url!.includes("/unbounded")) {
    const total = 32 * 1024 * 1024,
      chunk = Buffer.alloc(65536, 7);
    if (!req.url!.includes("/unbounded"))
      res.setHeader("Content-Length", total);
    res.on("close", () => {
      if (!res.writableFinished) cancelled++;
    });
    res.on("error", () => {});
    while (produced < total && !res.destroyed) {
      produced += chunk.length;
      if (!res.write(chunk)) await drain(res);
    }
    if (!res.destroyed) res.end();
    return;
  }
  if (req.url!.includes("/stall")) {
    res.setHeader("Content-Length", 1000);
    res.flushHeaders();
    res.on("close", () => {
      if (!res.writableFinished) cancelled++;
    });
    return;
  }
  let start = 0,
    end = bytes.length - 1;
  if (req.headers.range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)!;
    if (parts[1]) {
      start = Number(parts[1]);
      end = parts[2] ? Math.min(Number(parts[2]), end) : end;
    } else start = Math.max(0, bytes.length - Number(parts[2]));
    if (start >= bytes.length) {
      res.writeHead(416, { "Content-Type": "application/xml" });
      res.end(
        "<Error><Code>InvalidRange</Code><Message>Range not satisfiable</Message></Error>",
      );
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  }
  res.setHeader("Content-Length", end - start + 1);
  res.end(bytes.subarray(start, end + 1));
});
function drain(response: ServerResponse) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      response.off("drain", finish);
      response.off("close", finish);
      resolve();
    };
    response.once("drain", finish);
    response.once("close", finish);
  });
}
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fixture.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const request = (headers: HeadersInit = {}, method = "GET") =>
  new Request("http://app.test/api/uploads/id", { headers, method });
const fileHeaders = {
  "Content-Type": "application/pdf",
  "Content-Disposition": "attachment; filename=test.pdf",
};

it("streams complete bytes with progress headers and handles HEAD without fetching the body", async () => {
  const begin = calls.length;
  const head = await objectDownload(request({}, "HEAD"), "normal", fileHeaders);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(head.headers.get("Content-Length")).toBe(String(bytes.length));
  expect(calls.slice(begin).map((c) => c.method)).toEqual(["HEAD"]);
  const full = await objectDownload(request(), "normal", fileHeaders);
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
  expect(full.headers.get("Cache-Control")).toBe("private, no-store");
  expect(full.headers.get("Accept-Ranges")).toBe("bytes");
  expect(full.headers.get("Content-Disposition")).toContain("attachment");
  expect(full.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

it("serves single ranges, suffixes and open ranges, and rejects invalid or unsatisfiable ranges", async () => {
  for (const [range, start, end] of [
    ["bytes=2-5", 2, 5],
    ["bytes=33-", 33, 35],
    ["bytes=-4", 32, 35],
  ] as const) {
    const response = await objectDownload(
      request({ Range: range }),
      "normal",
      fileHeaders,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes ${start}-${end}/${bytes.length}`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(start, end + 1),
    );
  }
  for (const range of [
    "bytes=99-100",
    "bytes=4-1",
    "bytes=-0",
    "bytes=0-1,4-5",
    "bytes=9007199254740992-",
    "bytes=-",
    "",
  ]) {
    const response = await objectDownload(
      request({ Range: range }),
      "normal",
      fileHeaders,
    );
    expect(response.status, range).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes */${bytes.length}`,
    );
    expect(await response.text()).toBe("");
  }
});

it("uses If-Range validators and ignores a stale or weak validator instead of appending different bytes", async () => {
  for (const validator of ['"fixture-v1"', "Thu, 01 Oct 2026 10:00:00 GMT"]) {
    const response = await objectDownload(
      request({ Range: "bytes=0-1", "If-Range": validator }),
      "normal",
      fileHeaders,
    );
    expect(response.status).toBe(206);
    await response.arrayBuffer();
  }
  for (const validator of [
    '"old"',
    'W/"fixture-v1"',
    "Wed, 30 Sep 2026 10:00:00 GMT",
    "invalid",
  ]) {
    const response = await objectDownload(
      request({ Range: "bytes=0-1", "If-Range": validator }),
      "normal",
      fileHeaders,
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  }
});

it("does not drain a large object before a consumer reads and cancels the real SDK HTTP transfer", async () => {
  produced = 0;
  const closedBefore = cancelled;
  const object = await openObject("stream");
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  expect(produced).toBeLessThan(32 * 1024 * 1024);
  const reader = object.body.getReader();
  expect((await reader.read()).value!.byteLength).toBeGreaterThan(0);
  await reader.cancel();
  await vi.waitFor(() => expect(cancelled).toBe(closedBefore + 1));
});

it("propagates request cancellation and bounds a stalled upstream transfer", async () => {
  const abort = new AbortController();
  const object = await openObject("stall", { signal: abort.signal });
  const reader = object.body.getReader(),
    pending = reader.read();
  const rejected = expect(pending).rejects.toThrow();
  abort.abort();
  await rejected;
  const timed = await openObject("stall", { maximumDurationMs: 500 });
  await expect(timed.body.getReader().read()).rejects.toThrow();
});

it("bounds internal buffered reads by declared and streamed bytes", async () => {
  expect(await getObject("normal", { maximumBytes: bytes.length })).toEqual(
    bytes,
  );
  await expect(
    getObject("normal", { maximumBytes: bytes.length - 1 }),
  ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
  produced = 0;
  const closedBefore = cancelled;
  await expect(
    getObject("unbounded", { maximumBytes: 1024 }),
  ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
  await vi.waitFor(() => expect(cancelled).toBeGreaterThan(closedBefore));
  expect(produced).toBeLessThan(32 * 1024 * 1024);
});

it("cancels a buffered storage read on abort or total timeout", async () => {
  const abort = new AbortController();
  const pending = getObject("stall", { signal: abort.signal });
  const rejected = expect(pending).rejects.toThrow();
  abort.abort();
  await rejected;
  await expect(
    getObject("stall", { maximumDurationMs: 100 }),
  ).rejects.toThrow();
});
