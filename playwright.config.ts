import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup:'./tests/e2e/global-setup.ts',
  timeout: 120000,
  expect:{timeout:10000},
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    headless: true,
    actionTimeout:20000,
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
