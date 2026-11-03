import { expect, it } from "vitest";
import { withFileBufferCapacity } from "../apps/web/lib/file-buffer-capacity";
it("rejects excess concurrent buffered file operations and releases capacity after both success and failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const first = withFileBufferCapacity(() => gate);
  const second = withFileBufferCapacity(async () => {
    await gate;
    throw new Error("synthetic failure");
  });
  const failure = expect(second).rejects.toThrow("synthetic failure");
  try {
    await expect(
      withFileBufferCapacity(async () => true),
    ).rejects.toMatchObject({
      code: "LIMIT",
      status: 429,
    });
  } finally {
    release();
    await first;
    await failure;
  }
  expect(await withFileBufferCapacity(async () => "available")).toBe(
    "available",
  );
});
