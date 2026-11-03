import { afterEach, expect, it, vi } from "vitest";
vi.mock("../server/config/env", () => ({
  env: () => ({
    RENDERER_URL: "http://renderer.example.test",
    RENDERER_TOKEN: "synthetic-renderer-token",
  }),
}));
import { isolatedRequest } from "../server/infrastructure/documents/renderer";
afterEach(() => vi.unstubAllGlobals());

it.each([
  { code: "private document text" },
  { code: { privateText: "source fragment" } },
  { code: "__proto__" },
  { code: "toString" },
  null,
])("never exposes arbitrary renderer error data: %j", async (payload) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(payload, { status: 422 })),
  );
  await expect(
    isolatedRequest("parse", Buffer.from("fixture"), "docx"),
  ).rejects.toMatchObject({ code: "RENDER_UNAVAILABLE", status: 503 });
});

it.each([401, 403, 404, 500, 503])(
  "does not turn renderer infrastructure status %s into an end-user authentication error",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "UNAUTHORIZED" }, { status })),
    );
    await expect(
      isolatedRequest("inspect", Buffer.from("fixture"), "docx"),
    ).rejects.toMatchObject({ code: "RENDER_UNAVAILABLE", status: 503 });
  },
);

it.each([
  ["FILE_INVALID", 422],
  ["FILE_SIZE", 413],
  ["OCR_UNAVAILABLE", 422],
  ["FONT_UNAVAILABLE", 422],
] as const)(
  "preserves the supported renderer error %s",
  async (code, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code }, { status })),
    );
    await expect(
      isolatedRequest("parse", Buffer.from("fixture"), "docx"),
    ).rejects.toMatchObject({ code, status });
  },
);

it("bounds real renderer bytes even when Content-Length understates a chunked response", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel: cancelled,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(body, { headers: { "content-length": "1" } }),
    ),
  );
  await expect(
    isolatedRequest("parse", Buffer.from("synthetic"), "docx"),
  ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
  expect(cancelled).toHaveBeenCalledOnce();
});

it("rejects excessive declared renderer lengths before collecting bytes", async () => {
  const cancelled = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel: cancelled }), {
          headers: { "content-length": String(64 * 1024 + 1) },
        }),
    ),
  );
  await expect(
    isolatedRequest("inspect", Buffer.from("synthetic"), "docx"),
  ).rejects.toMatchObject({ code: "FILE_SIZE" });
  expect(cancelled).toHaveBeenCalledOnce();
});

it("preserves UTF-8 in bounded parser responses", async () => {
  const value = Buffer.from('{"topic":"Қазақ тілі"}');
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of value)
                controller.enqueue(new Uint8Array([byte]));
              controller.close();
            },
          }),
        ),
    ),
  );
  expect(
    (await isolatedRequest("parse", Buffer.from("synthetic"), "docx")).toString(
      "utf8",
    ),
  ).toBe(value.toString("utf8"));
});
