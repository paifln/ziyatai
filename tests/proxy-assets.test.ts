import { expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../proxy";
it("leaves immutable assets cacheable while HTML keeps the request-specific CSP", () => {
  for (const url of [
    "/assets/lite.123456abcdef.js",
    "/assets/onest.123456abcdef.woff2",
    "/_next/static/chunks/test.js",
  ])
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      false,
    );
  expect(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/" }),
  ).toBe(true);
});
