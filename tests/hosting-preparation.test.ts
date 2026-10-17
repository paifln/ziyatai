import { expect, it } from "vitest";
import { hostingFiles } from "../scripts/prepare-hosting";
const input = {
  siteId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  siteOrigin: "https://school.netlify.app",
  operator: "Synthetic operator",
};
it("keeps backend keys out of Netlify and preserves existing credentials on repeated preparation", () => {
  const first = hostingFiles(input, {
    OPENAI_API_KEY: "synthetic-backend-key",
    GOOGLE_CLIENT_ID: "synthetic-google-id",
    GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    APPLE_CLIENT_ID: "synthetic-apple-id",
    APPLE_CLIENT_SECRET: "synthetic-apple-secret",
  });
  expect(first.frontend.NETLIFY_PROXY_SECRET).toBe(
    first.backend.NETLIFY_PROXY_SECRET,
  );
  expect(Object.keys(first.frontend).sort()).toEqual([
    "LEGAL_CONTACT_EMAIL",
    "LEGAL_OPERATOR_NAME",
    "NETLIFY_PROXY_SECRET",
    "UPLOAD_ORIGIN",
    "ZIYATAI_API_ORIGIN",
  ]);
  expect(JSON.stringify(first.frontend)).not.toContain("synthetic-backend-key");
  for (const key of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_CLIENT_ID",
    "APPLE_CLIENT_SECRET",
  ]) {
    expect(first.backend[key]).toBeTruthy();
    expect(first.frontend).not.toHaveProperty(key);
    expect(JSON.stringify(first.frontend)).not.toContain(first.backend[key]);
  }
  const second = hostingFiles(input, {}, first.backend, first.frontend);
  expect(second.backend).toEqual(first.backend);
  expect(first.unresolved).toContain("ZIYATAI_API_ORIGIN");
});
it("rejects unsafe origins and conflicting proxy credentials before files are written", () => {
  expect(() =>
    hostingFiles({ ...input, siteOrigin: "http://example.test" }, {}),
  ).toThrow();
  expect(() =>
    hostingFiles(
      input,
      {},
      { NETLIFY_PROXY_SECRET: "first" },
      { NETLIFY_PROXY_SECRET: "second" },
    ),
  ).toThrow();
});
