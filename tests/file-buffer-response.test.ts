import { expect, it } from "vitest";
import {
  withFileBufferResponse,
  withFileBufferCapacity,
} from "../apps/web/lib/file-buffer-capacity";

it("holds admission until response completion or cancellation and chunks large buffers", async () => {
  const response = () =>
    withFileBufferResponse(
      async () => new Response(new Uint8Array(150000)),
      new AbortController().signal,
    );
  const first = await response(),
    second = await response();
  await expect(withFileBufferCapacity(async () => true)).rejects.toMatchObject({
    code: "LIMIT",
  });
  const reader = first.body!.getReader();
  expect((await reader.read()).value!.byteLength).toBe(65536);
  await reader.cancel();
  await expect(withFileBufferCapacity(async () => true)).resolves.toBe(true);
  expect((await second.arrayBuffer()).byteLength).toBe(150000);
  await expect(withFileBufferCapacity(async () => true)).resolves.toBe(true);
});

it("abort frees a stalled response slot", async () => {
  const abort = new AbortController();
  const response = await withFileBufferResponse(
    async () => new Response("private bytes"),
    abort.signal,
  );
  abort.abort();
  await expect(response.text()).rejects.toThrow("File transfer interrupted");
  await expect(withFileBufferCapacity(async () => true)).resolves.toBe(true);
});
