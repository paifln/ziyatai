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
  it.each(["declared", "streamed"])(
    "does not await a stuck cancellation callback after rejecting %s size",
    async (kind) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (kind === "streamed") controller.enqueue(new Uint8Array(11));
        },
        cancel() {
          return new Promise(() => {});
        },
      });
      const headers = new Headers(
        kind === "declared" ? { "content-length": "11" } : {},
      );
      await expect(
        readBoundedBody({ headers, body }, 10),
      ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
      expect(body.locked).toBe(false);
    },
  );
  it("expires a stalled body even if its cancellation callback never resolves", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    });
    await expect(
      readBoundedBody({ headers: new Headers(), body }, 100, { timeoutMs: 25 }),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 408 });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("uses an overall body deadline even when chunks keep arriving", async () => {
    let timer: ReturnType<typeof setInterval>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => controller.enqueue(new Uint8Array([65])), 5);
      },
      cancel() {
        clearInterval(timer);
      },
    });
    await expect(
      readBoundedBody({ headers: new Headers(), body }, 1000, {
        timeoutMs: 35,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 408 });
  });

  it("cancels active JSON reads with their request lifetime", async () => {
    const abort = new AbortController();
    let cancelled = false;
    const request = new Request("http://localhost", {
      method: "POST",
      signal: abort.signal,
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit);
    const pending = readJsonBody(request);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      status: 408,
    });
    abort.abort();
    await rejected;
    expect(cancelled).toBe(true);
  });

  it("rejects an already cancelled body without waiting for data", async () => {
    const body = new ReadableStream<Uint8Array>();
    await expect(
      readBoundedBody({ headers: new Headers(), body }, 10, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 408 });
    expect(body.locked).toBe(false);
  });
  it("collects tiny network chunks in order across buffer growth without trailing bytes", async () => {
    const total = 17001;
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === total) controller.close();
        else controller.enqueue(new Uint8Array([offset++ % 256]));
      },
    });
    const result = await readBoundedBody(
      { headers: new Headers(), body },
      total + 100,
    );
    expect(result.byteLength).toBe(total);
    expect(result).toEqual(
      Uint8Array.from({ length: total }, (_, index) => index % 256),
    );
  });

  it("cancels invalid declared-length input before returning its error", async () => {
    let cancelled = false;
    await expect(
      readBoundedBody(
        {
          headers: new Headers({ "content-length": "invalid" }),
          body: new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        },
        10,
      ),
    ).rejects.toMatchObject({ code: "FILE_INVALID", status: 400 });
    expect(cancelled).toBe(true);
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid internal byte limits instead of bypassing the boundary: %s",
    async (maximum) => {
      await expect(
        readBoundedBody(streamed(["body"]), maximum),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );
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
