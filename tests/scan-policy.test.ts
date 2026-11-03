import { test, expect } from "vitest";
import { trustedScan } from "../server/infrastructure/antivirus/scan-policy";

test("only explicit local development without required scanning trusts the development marker", () => {
  for (const APP_ENV of ["local", "staging", "production"])
    for (const SCAN_REQUIRED of ["true", "false"]) {
      const policy = { APP_ENV, SCAN_REQUIRED };
      expect(trustedScan("clean", policy)).toBe(true);
      expect(trustedScan("unscanned-development", policy)).toBe(
        APP_ENV === "local" && SCAN_REQUIRED === "false",
      );
      for (const status of ["pending", "rejected", "infected", "unknown", ""])
        expect(trustedScan(status, policy)).toBe(false);
    }
});
