import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import { sessionReadPolicy } from "../../apps/web/lib/session-read-budget";

test("session reads below four per second remain available beyond a minute without an idle gap", async ({
  playwright,
}) => {
  test.setTimeout(120000);
  const context = await playwright.request.newContext({
    baseURL: qaOrigin,
    extraHTTPHeaders: { "x-forwarded-for": `192.0.2.${randomInt(1, 255)}` },
  });
  const began = performance.now();
  try {
    for (let index = 0; index < 260; index++) {
      if (index) await new Promise((resolve) => setTimeout(resolve, 270));
      const response = await context.get(
        `/api/auth/get-session?steady=${index}`,
      );
      expect(
        response.status(),
        `Read ${index + 1}; elapsed ${Math.round(performance.now() - began)}ms`,
      ).toBe(200);
      expect(await response.json()).toBeNull();
    }
    expect(performance.now() - began).toBeGreaterThan(60000);
  } finally {
    await context.dispose();
  }
});

test("session bursts are bounded across query/cookie variants and refill without an idle minute", async ({
  playwright,
}) => {
  const context = await playwright.request.newContext({
    baseURL: qaOrigin,
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${randomInt(1, 255)}` },
  });
  const separate = await playwright.request.newContext({
    baseURL: qaOrigin,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${randomInt(1, 255)}` },
  });
  try {
    const began = performance.now();
    const responses = await Promise.all(
      Array.from({ length: 160 }, (_, index) =>
        context.get(`/api/auth/get-session?burst=${index}`, {
          headers: { Cookie: `synthetic-variant=${index}` },
        }),
      ),
    );
    const elapsed = performance.now() - began;
    expect(responses.every((r) => [200, 429].includes(r.status()))).toBe(true);
    const accepted = responses.filter((r) => r.status() === 200);
    const denied = responses.filter((r) => r.status() === 429);
    expect(accepted.length).toBeGreaterThanOrEqual(sessionReadPolicy.burst);
    expect(accepted.length).toBeLessThanOrEqual(
      sessionReadPolicy.burst +
        Math.ceil((elapsed * sessionReadPolicy.perMinute) / 60000) +
        2,
    );
    expect(denied.length).toBeGreaterThan(0);
    for (const response of denied) {
      expect((await response.json()).code).toBe("READ_LIMIT");
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers().vary?.toLowerCase()).toContain("cookie");
      expect(response.headers()["retry-after"]).toBe("1");
      expect(response.headers()["x-retry-after"]).toBe("1");
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    expect((await separate.get("/api/auth/get-session")).status()).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(
      (await context.get("/api/auth/get-session?after-refill=1")).status(),
    ).toBe(200);
  } finally {
    await context.dispose();
    await separate.dispose();
  }
});
