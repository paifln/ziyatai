import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ origin: "" }));
vi.mock("../server/config/env", () => ({
  env: () => ({
    RENDERER_URL: fixture.origin,
    RENDERER_TOKEN: "synthetic-renderer-token",
  }),
}));
import { isolatedRequest } from "../server/infrastructure/documents/renderer";

it("refuses renderer redirects rather than forwarding a document and bearer token", async () => {
  let redirected = 0;
  const server = createServer((request, response) => {
    request.resume();
    if (request.url === "/capture") {
      redirected++;
      response.end("unexpected private transfer");
    } else {
      response.writeHead(307, { Location: "/capture" });
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fixture.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await expect(
      isolatedRequest("parse", Buffer.from("synthetic document"), "docx"),
    ).rejects.toMatchObject({ code: "RENDER_UNAVAILABLE", status: 503 });
    expect(redirected).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("cancels a stalled renderer response when the requesting client disconnects", async () => {
  let closed = false;
  let started = false;
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "Content-Type": "image/png" });
    response.write("synthetic partial preview");
    response.once("close", () => {
      closed = true;
    });
    started = true;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fixture.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const abort = new AbortController();
  const pending = isolatedRequest(
    "preview",
    Buffer.from("synthetic document"),
    "pdf",
    {
      signal: abort.signal,
    },
  );
  const rejected = expect(pending).rejects.toMatchObject({
    code: "RENDER_UNAVAILABLE",
    status: 503,
  });
  try {
    await vi.waitFor(() => expect(started).toBe(true), { timeout: 5000 });
    abort.abort();
    await rejected;
    await vi.waitFor(() => expect(closed).toBe(true));
  } finally {
    abort.abort();
    await pending.catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
