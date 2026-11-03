import { describe, expect, it } from "vitest";
import { authFailureMessage } from "../apps/web/lib/auth-feedback";
describe("authentication feedback", () => {
  it.each(["ru", "kk"] as const)(
    "distinguishes outages, invalid credentials and rate limits (%s)",
    (locale) => {
      const unavailable = authFailureMessage({ status: 503 }, locale);
      expect(unavailable).toBe(
        authFailureMessage({ code: "AUTH_UNAVAILABLE" }, locale),
      );
      expect(unavailable).not.toBe(authFailureMessage({ status: 401 }, locale));
      expect(unavailable).not.toBe(authFailureMessage({ status: 429 }, locale));
    },
  );
});
