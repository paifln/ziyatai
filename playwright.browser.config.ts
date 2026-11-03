import { defineConfig } from "@playwright/test";

// Deterministic browser contracts; no database, credentials or running services.
export default defineConfig({
  testDir: "tests/browser",
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  use: {
    browserName: process.env.QA_BROWSER === "webkit" ? "webkit" : "chromium",
    channel:
      process.env.CI || process.env.QA_BROWSER === "webkit"
        ? undefined
        : "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: "list",
});
