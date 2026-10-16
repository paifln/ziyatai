import { expect, it } from "vitest";
import { withUploadCapacity } from "../apps/web/lib/upload-capacity";
it("rejects excess concurrent uploads and releases capacity after both success and failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const first = withUploadCapacity(() => gate);
  const second = withUploadCapacity(async () => {
    await gate;
    throw new Error("synthetic failure");
  });
  const failure = expect(second).rejects.toThrow("synthetic failure");
  try {
    await expect(withUploadCapacity(async () => true)).rejects.toMatchObject({
      code: "LIMIT",
      status: 429,
    });
  } finally {
    release();
    await first;
    await failure;
  }
  expect(await withUploadCapacity(async () => "available")).toBe("available");
});
