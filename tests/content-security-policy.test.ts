import { expect, it } from "vitest";
import { contentSecurityPolicy } from "../packages/domain/content-security-policy";
it("requires a valid nonce for inline scripts and excludes eval from production", () => {
  const csp = contentSecurityPolicy({
    nonce: "abcdefghijklmnopqrstuvwx",
    uploadOrigin: "https://files.example.test/path",
  });
  const scripts = csp
    .split(";")
    .find((directive) => directive.includes("script-src"));
  expect(scripts).toContain("'nonce-abcdefghijklmnopqrstuvwx'");
  expect(scripts).toContain("'strict-dynamic'");
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).not.toContain("'unsafe-eval'");
  expect(csp).toContain("connect-src 'self' https://files.example.test;");
  expect(csp).toContain("object-src 'none'");
});
it("keeps static Lite self-contained and rejects header injection", () => {
  expect(contentSecurityPolicy({}).split(";")[1]).toBe(" script-src 'self'");
  expect(() =>
    contentSecurityPolicy({ nonce: "bad'; script-src *" }),
  ).toThrow();
  expect(() =>
    contentSecurityPolicy({ uploadOrigin: "javascript:alert(1)" }),
  ).toThrow();
});
