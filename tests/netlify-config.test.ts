import { describe, expect, it } from "vitest";
import { createNetlifyRouting } from "../scripts/prepare-netlify.mjs";

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
    expect(result.redirects.split("\n")[0]).toBe(
      "/api/* https://api.example.test/api/:splat 200!",
    );
    expect(result.headers).toContain(
      "connect-src 'self' https://storage.example.test;",
    );
    expect(result.headers).not.toContain("'unsafe-eval'");
    expect(result.redirects).not.toContain("301");
  });
});
