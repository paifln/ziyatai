import { afterEach, describe, expect, it, vi } from "vitest";
import { createNetlifyRouting } from "../scripts/build/prepare-netlify.mjs";
import { onPreBuild } from "../infra/netlify-proxy/index.js";
afterEach(() => vi.unstubAllEnvs());

describe("Netlify routing", () => {
  it("fails closed when a backend is missing or an origin can inject configuration", () => {
    for (const value of [
      undefined,
      "http://api.example.test",
      "https://user:pass@api.example.test",
      "https://api.example.test/x",
      "https://api.example.test/?x=1",
      "https://api.example.test/#fragment",
      "https://api.example.test/\n/* https://evil.example.test 200!",
    ])
      expect(() =>
        createNetlifyRouting(value, "https://storage.example.test"),
      ).toThrow();
    expect(() =>
      createNetlifyRouting("https://api.example.test", undefined),
    ).toThrow();
  });
  it("proxies all API methods before framework routes and restricts uploads to one origin", () => {
    const result = createNetlifyRouting(
      "https://api.example.test/",
      "https://storage.example.test",
    );
    expect(result.apiRedirect).toEqual({
      from: "/api/*",
      to: "https://api.example.test/api/:splat",
      status: 200,
      force: true,
      signed: "NETLIFY_PROXY_SECRET",
    });
    expect(result.redirects).not.toContain("/api/");
    expect(result.headers).toContain(
      "connect-src 'self' https://storage.example.test;",
    );
    expect(result.headers).not.toContain("'unsafe-eval'");
    expect(result.redirects).not.toContain("301");
  });
  it("adds signed proxy configuration before framework routes without exposing the key", () => {
    vi.stubEnv("ZIYATAI_API_ORIGIN", "https://api.example.test");
    vi.stubEnv("UPLOAD_ORIGIN", "https://storage.example.test");
    vi.stubEnv(
      "NETLIFY_PROXY_SECRET",
      "this-value-must-never-enter-the-routing-file",
    );
    const netlifyConfig = { redirects: [{ from: "/*", to: "/framework" }] };
    onPreBuild({ netlifyConfig });
    expect(netlifyConfig.redirects[0]).toMatchObject({
      from: "/api/*",
      signed: "NETLIFY_PROXY_SECRET",
      force: true,
    });
    expect(JSON.stringify(netlifyConfig)).not.toContain(
      process.env.NETLIFY_PROXY_SECRET,
    );
  });
});
