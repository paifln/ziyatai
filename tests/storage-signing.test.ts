import { afterEach, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({
  STORAGE_ENDPOINT: "https://s3.example.test",
  STORAGE_PUBLIC_ENDPOINT: "https://upload.example.test",
  STORAGE_REGION: "auto",
  STORAGE_BUCKET: "private-lessons",
  STORAGE_FORCE_PATH_STYLE: "true",
  STORAGE_ACCESS_KEY: "synthetic-access",
  STORAGE_SECRET_KEY: "synthetic-secret",
}));
vi.mock("../apps/web/lib/env", () => ({ env: () => config }));
afterEach(() => {
  config.STORAGE_FORCE_PATH_STYLE = "true";
});
it("binds private upload signatures to size, content type and the exact path-style endpoint", async () => {
  const { signedUpload } = await import("../apps/web/lib/storage");
  const url = new URL(
    await signedUpload(
      "quarantine/test/lesson.xlsx",
      4096,
      "application/octet-stream",
    ),
  );
  expect(url.hostname).toBe("upload.example.test");
  expect(url.pathname).toBe("/private-lessons/quarantine/test/lesson.xlsx");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
    "content-length;content-type;host",
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
});
it("supports virtual-hosted buckets without signing the path-style URL by mistake", async () => {
  config.STORAGE_FORCE_PATH_STYLE = "false";
  const { signedUpload } = await import("../apps/web/lib/storage");
  const url = new URL(
    await signedUpload(
      "quarantine/test/lesson.xlsx",
      4096,
      "application/octet-stream",
    ),
  );
  expect(url.hostname).toBe("private-lessons.upload.example.test");
  expect(url.pathname).toBe("/quarantine/test/lesson.xlsx");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
    "content-length",
  );
});
