import { describe, expect, it } from "vitest";
import {
  boundedRequest,
  readBoundedBody,
  readJsonBody,
} from "../apps/web/lib/request-body";

function streamed(chunks: string[], headers?: Record<string, string>) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
}
describe("request body boundaries", () => {
  it("rejects oversized chunked input without trusting a smaller declared length", async () => {
    await expect(
      readBoundedBody(streamed(["1234", "5678"], { "content-length": "2" }), 6),
    ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
  });
  it("rejects an excessive declared length before pulling the body", async () => {
    let cancelled = false;
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": "100" },
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedBody(request, 10)).rejects.toMatchObject({
      status: 413,
    });
    expect(cancelled).toBe(true);
  });
  it("counts UTF-8 bytes, accepts the exact boundary and preserves the body for the next parser", async () => {
    const request = streamed(['{"name":"Ә"}'], {
      "content-type": "application/json",
      origin: "http://localhost",
    });
    const bounded = await boundedRequest(request, 13);
    expect(await bounded.json()).toEqual({ name: "Ә" });
    expect(bounded.headers.get("origin")).toBe("http://localhost");
  });
  it("returns a client error for malformed JSON or invalid UTF-8", async () => {
    await expect(readJsonBody(streamed(["{"]))).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      readJsonBody(
        new Request("http://localhost", {
          method: "POST",
          body: new Uint8Array([0xff]),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rejects malformed lengths", async () => {
    await expect(
      readBoundedBody(streamed(["{}"], { "content-length": "-1" }), 10),
    ).rejects.toMatchObject({ status: 400 });
  });
});
