import { defineConfig, devices } from "@playwright/test";
const useWebKit = process.env.QA_BROWSER === "webkit";
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120000,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    ...(useWebKit ? devices["Desktop Safari"] : {}),
    browserName: useWebKit ? "webkit" : "chromium",
    baseURL: "http://localhost:3000",
    channel: useWebKit || process.env.CI ? undefined : "chrome",
    headless: true,
    actionTimeout: 20000,
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
