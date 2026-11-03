import { expect, it } from "vitest";
import { hostingFiles } from "../scripts/deploy/prepare-hosting";
const input = {
  siteId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  siteOrigin: "https://school.netlify.app",
  operator: "Synthetic operator",
};
it("keeps backend keys out of Netlify and preserves existing credentials on repeated preparation", () => {
  const first = hostingFiles(input, {
    OPENAI_API_KEY: "synthetic-backend-key",
  });
  expect(first.frontend.NETLIFY_PROXY_SECRET).toBe(
    first.backend.NETLIFY_PROXY_SECRET,
  );
  expect(Object.keys(first.frontend).sort()).toEqual([
    "LEGAL_CONTACT_EMAIL",
    "LEGAL_OPERATOR_NAME",
    "NETLIFY_PROXY_SECRET",
    "NETLIFY_SITE_ID",
    "UPLOAD_ORIGIN",
    "ZIYATAI_API_ORIGIN",
  ]);
  expect(JSON.stringify(first.frontend)).not.toContain("synthetic-backend-key");
  const second = hostingFiles(input, {}, first.backend, first.frontend);
  expect(second.backend).toEqual(first.backend);
  expect(first.unresolved).toContain("ZIYATAI_API_ORIGIN");
});
it("prepares Supabase hosting without requiring Railway or copying unrelated credentials", () => {
  const netlifyInput = { ...input, projectId: undefined };
  const source = {
    SUPABASE_URL: "https://synthetic.supabase.co",
    SUPABASE_SECRET_KEY: "synthetic-admin-key",
    DATABASE_URL: "postgresql://synthetic",
    STORAGE_ENDPOINT: "https://synthetic.storage.supabase.co/storage/v1/s3",
    STORAGE_SECRET_KEY: "synthetic-storage-key",
    UNRELATED_SECRET: "keep-out",
    POSTGRES_PASSWORD: "obsolete",
  };
  const result = hostingFiles(netlifyInput, source);
  expect(result.backend).toMatchObject({
    SUPABASE_URL: source.SUPABASE_URL,
    SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY,
    DATABASE_URL: source.DATABASE_URL,
    STORAGE_ENDPOINT: source.STORAGE_ENDPOINT,
    API_GATEWAY: "netlify",
    APP_ENV: "production",
    RENDERER_URL: "http://renderer:8090",
    CLAMAV_HOST: "antivirus",
  });
  expect(result.backend).not.toHaveProperty("POSTGRES_PASSWORD");
  expect(result.backend).not.toHaveProperty("UNRELATED_SECRET");
  expect(result.frontend).not.toHaveProperty("SUPABASE_SECRET_KEY");
  expect(result.unresolved).toContain("SUPABASE_PUBLISHABLE_KEY");
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
