import { describe, expect, it } from "vitest";
import { deploymentChecks } from "../scripts/deployment-config";

const backend = {
  APP_ENV: "production",
  APP_URL: "https://school.netlify.app",
  NETLIFY_SITE_ID: "b0f3e39e-36bd-4d5e-bd5f-6c938fdc81bc",
  NETLIFY_PROXY_SECRET: "proxy-fixture-only-32-characters-long",
  AUTH_SECRET: "auth-fixture-only-32-characters-long",
  API_GATEWAY: "netlify",
  DIRECT_UPLOADS: "true",
  DATABASE_URL:
    "postgresql://fixture:private-password@postgres.railway.internal:5432/ziyatai",
  SCAN_REQUIRED: "true",
  ALLOW_DEMO: "false",
  CLAMAV_HOST: "antivirus.railway.internal",
  RENDERER_URL: "http://renderer.railway.internal:8090",
  RENDERER_TOKEN: "renderer-fixture-only-32-characters-long",
  OPENAI_API_KEY: "fixture-not-a-real-api-key",
  OPENAI_MODEL: "evaluated-model",
  SMTP_HOST: "smtp.example.net",
  SMTP_PORT: "587",
  SMTP_FROM: "ZiyatAI <mail@example.net>",
  SMTP_USER: "fixture-user",
  SMTP_PASSWORD: "private-smtp-password",
  STORAGE_ENDPOINT: "https://s3.example.net",
  STORAGE_REGION: "region-1",
  STORAGE_BUCKET: "teacher-files",
  STORAGE_ACCESS_KEY: "fixture-access",
  STORAGE_SECRET_KEY: "private-storage-key",
  STORAGE_FORCE_PATH_STYLE: "true",
  UPLOAD_ORIGIN: "https://s3.example.net",
  LEGAL_OPERATOR_NAME: "Fixture operator",
  LEGAL_CONTACT_EMAIL: "operator@example.net",
};
const blocked = async (values: Record<string, string | undefined>) =>
  (await deploymentChecks(values, "backend"))
    .filter((check) => check.status === "blocked")
    .map((check) => check.id);

describe("deployment preflight", () => {
  it("allows an explicitly mail-free launch while still rejecting missing mail in verification mode", async () => {
    const noMail = {
      ...backend,
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMTP_FROM: "",
    };
    expect(
      await blocked({ ...noMail, EMAIL_VERIFICATION_REQUIRED: "false" }),
    ).toEqual([]);
    expect(
      await blocked({ ...noMail, EMAIL_VERIFICATION_REQUIRED: "true" }),
    ).toContain("smtp");
  });
  it("accepts the backend shape while keeping external acceptance explicitly manual", async () => {
    const checks = await deploymentChecks(backend, "backend");
    expect(checks.filter((check) => check.status === "blocked")).toEqual([]);
    expect(
      checks
        .filter((check) => check.status === "manual")
        .map((check) => check.id),
    ).toEqual(
      expect.arrayContaining([
        "storage-policy",
        "fonts",
        "real-mail-ai",
        "backups",
        "live-acceptance",
      ]),
    );
  });
  it("detects the bucket subdomain mismatch that would break Netlify uploads", async () => {
    expect(
      await blocked({ ...backend, STORAGE_FORCE_PATH_STYLE: "false" }),
    ).toContain("upload-csp");
    expect(
      await blocked({
        ...backend,
        STORAGE_FORCE_PATH_STYLE: "false",
        UPLOAD_ORIGIN: "https://teacher-files.s3.example.net",
      }),
    ).toEqual([]);
  });
  it("signs against the public endpoint when the backend uses a different storage endpoint", async () => {
    expect(
      await blocked({
        ...backend,
        STORAGE_PUBLIC_ENDPOINT: "https://uploads.example.net",
        UPLOAD_ORIGIN: "https://uploads.example.net",
      }),
    ).toEqual([]);
    expect(
      await blocked({
        ...backend,
        STORAGE_PUBLIC_ENDPOINT: "https://uploads.example.net",
      }),
    ).toContain("upload-csp");
  });
  it("blocks reused secrets, disabled scan, demo fallback and indirect Netlify uploads", async () => {
    expect(
      await blocked({
        ...backend,
        AUTH_SECRET: backend.NETLIFY_PROXY_SECRET,
        SCAN_REQUIRED: "false",
        ALLOW_DEMO: "true",
        DIRECT_UPLOADS: "false",
      }),
    ).toEqual(expect.arrayContaining(["auth-secret", "scanning", "gateway"]));
  });
  it("reports malformed URLs without echoing credentials or raw values", async () => {
    const checks = await deploymentChecks(
      {
        ...backend,
        APP_URL: "https://secret-user:secret-pass@example.net/path?q=private",
        DATABASE_URL: "private-malformed-database",
        RENDERER_URL: "not-a-url",
        STORAGE_ENDPOINT: "https://private-key@example.net",
      },
      "backend",
    );
    const output = JSON.stringify(checks);
    for (const secret of [
      "secret-user",
      "secret-pass",
      "private-malformed-database",
      "private-key",
      backend.SMTP_PASSWORD,
      backend.STORAGE_SECRET_KEY,
      backend.OPENAI_API_KEY,
    ])
      expect(output).not.toContain(secret);
    expect(
      checks
        .filter((check) => check.status === "blocked")
        .map((check) => check.id),
    ).toEqual(
      expect.arrayContaining(["app-origin", "database", "renderer", "storage"]),
    );
  });
  it("rejects incomplete production credentials and invalid budgets", async () => {
    expect(
      await blocked({
        ...backend,
        OPENAI_API_KEY: "YOUR_SERVER_KEY",
        SMTP_PASSWORD: "",
        RENDERER_TOKEN: "short",
        DAILY_AI_LIMIT: "-1",
        LEGAL_CONTACT_EMAIL: "",
      }),
    ).toEqual(
      expect.arrayContaining([
        "ai",
        "smtp-auth",
        "renderer",
        "ai-budgets",
        "legal-contact",
      ]),
    );
  });
  it("checks the frontend independently without requiring backend credentials", async () => {
    const frontend = {
      NETLIFY_SITE_ID: backend.NETLIFY_SITE_ID,
      NETLIFY_PROXY_SECRET: backend.NETLIFY_PROXY_SECRET,
      UPLOAD_ORIGIN: backend.UPLOAD_ORIGIN,
      ZIYATAI_API_ORIGIN: "https://api.example.net",
      LEGAL_OPERATOR_NAME: backend.LEGAL_OPERATOR_NAME,
      LEGAL_CONTACT_EMAIL: backend.LEGAL_CONTACT_EMAIL,
    };
    expect(
      (await deploymentChecks(frontend, "frontend")).filter(
        (check) => check.status === "blocked",
      ),
    ).toEqual([]);
    for (const key of [
      "OPENAI_API_KEY",
      "GOOGLE_CLIENT_SECRET",
      "APPLE_CLIENT_SECRET",
    ])
      expect(
        (
          await deploymentChecks(
            { ...frontend, [key]: "accidentally-copied-key" },
            "frontend",
          )
        ).find((check) => check.id === "frontend-secrets")?.status,
      ).toBe("blocked");
  });
  it("rejects local and credential-bearing public origins", async () => {
    for (const APP_URL of [
      "http://example.net",
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
      "https://example.net/path",
      "https://example.net#private",
      "https://user:pass@example.net",
    ])
      expect(await blocked({ ...backend, APP_URL })).toContain("app-origin");
  });
});
