import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
function configured() {
  const values = {
    APP_ENV: "production",
    API_GATEWAY: "direct",
    DATABASE_URL: "postgresql://test:test@localhost/qa",
    AUTH_SECRET: "a".repeat(32),
    APP_URL: "https://school.example.test/",
    STORAGE_ENDPOINT: "https://storage.example.test",
    STORAGE_REGION: "test",
    STORAGE_BUCKET: "qa",
    STORAGE_ACCESS_KEY: "test-access",
    STORAGE_SECRET_KEY: "c".repeat(32),
    SMTP_HOST: "smtp.example.test",
    SMTP_FROM: "qa@example.test",
    RENDERER_URL: "http://renderer:8090",
    RENDERER_TOKEN: "b".repeat(32),
    SCAN_REQUIRED: "true",
    ALLOW_DEMO: "false",
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
it("does not cache a rejected production configuration", async () => {
  configured();
  vi.stubEnv("SCAN_REQUIRED", "false");
  const { env } = await import("../apps/web/lib/env");
  expect(() => env()).toThrow("Production requires scanning");
  expect(() => env()).toThrow("Production requires scanning");
});
it("requires distinct proxy credentials and a site ID before enabling the Netlify gateway", async () => {
  configured();
  vi.stubEnv("API_GATEWAY", "netlify");
  vi.stubEnv("NETLIFY_PROXY_SECRET", "");
  vi.stubEnv("NETLIFY_SITE_ID", "");
  const { env } = await import("../apps/web/lib/env");
  expect(() => env()).toThrow("Netlify gateway requires");
  vi.stubEnv("NETLIFY_PROXY_SECRET", "a".repeat(32));
  vi.stubEnv("NETLIFY_SITE_ID", "b0f3e39e-36bd-4d5e-bd5f-6c938fdc81bc");
  expect(() => env()).toThrow("must differ");
  vi.stubEnv("NETLIFY_PROXY_SECRET", "n".repeat(32));
  expect(() => env()).toThrow("direct S3 uploads");
  vi.stubEnv("DIRECT_UPLOADS", "true");
  expect(env().API_GATEWAY).toBe("netlify");
});
it("canonicalizes the application origin and requires TLS for direct production uploads", async () => {
  configured();
  vi.stubEnv("DIRECT_UPLOADS", "true");
  vi.stubEnv("STORAGE_PUBLIC_ENDPOINT", "http://storage.example.test");
  const { env } = await import("../apps/web/lib/env");
  expect(() => env()).toThrow("HTTPS");
  vi.stubEnv("STORAGE_PUBLIC_ENDPOINT", "https://storage.example.test");
  expect(env().APP_URL).toBe("https://school.example.test");
});
