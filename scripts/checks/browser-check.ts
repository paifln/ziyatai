import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base =
  process.env.QA_BASE_URL || process.env.QA_ORIGIN || "http://localhost:3000";
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const browserVersion = browser.version();
const results = [];
await mkdir(".local/qa", { recursive: true });
try {
  for (const width of [360, 1440])
    for (const path of ["/", "/lite/"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 1600000 / 8,
        uploadThroughput: 750000 / 8,
      });
      await page.addInitScript(() => {
        const measurements = { lcp: 0, longTasks: 0, longTaskMs: 0 };
        (
          window as unknown as { ziyatMeasurements: typeof measurements }
        ).ziyatMeasurements = measurements;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              measurements.lcp = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              measurements.longTasks++;
              measurements.longTaskMs += entry.duration;
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {}
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + path);
      if (path === "/") {
        await page.locator(".landing-hero h1").waitFor({ timeout: 30000 });
        await page.locator('.hero-actions a[href="/signup"]').waitFor();
      } else
        await page
          .getByLabel("Email", { exact: true })
          .waitFor({ timeout: 30000 });
      await page.waitForLoadState("load");
      await page.waitForTimeout(1200);
      const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType(
          "resource",
        ) as PerformanceResourceTiming[];
        const scripts = resources.filter((r) => r.initiatorType === "script");
        return {
          navigationMs: Math.round(navigation.loadEventEnd),
          domReadyMs: Math.round(navigation.domContentLoadedEventEnd),
          lcpMs: Math.round(
            (window as unknown as { ziyatMeasurements: { lcp: number } })
              .ziyatMeasurements.lcp,
          ),
          transferredBytes:
            resources.reduce((n, r) => n + r.transferSize, 0) +
            navigation.transferSize,
          javascriptBytes: scripts.reduce((n, r) => n + r.encodedBodySize, 0),
          javascriptDecodedBytes: scripts.reduce(
            (n, r) => n + r.decodedBodySize,
            0,
          ),
          scriptRequests: scripts.length,
          fontRequests: resources.filter((r) =>
            /\.(woff2?|ttf|otf)(\?|$)/.test(r.name),
          ).length,
          resourceRequests: resources.length + 1,
          thirdPartyResources: resources.filter(
            (r) => new URL(r.name).origin !== location.origin,
          ).length,
          domElements: document.getElementsByTagName("*").length,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          ...(
            window as unknown as {
              ziyatMeasurements: { longTasks: number; longTaskMs: number };
            }
          ).ziyatMeasurements,
        };
      });
      await page.screenshot({
        path: `.local/qa/production-${path === "/" ? "landing" : "lite"}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      results.push({
        interface: path === "/" ? "landing" : "lite",
        width,
        ...metrics,
        errors,
      });
      console.log(JSON.stringify(results[results.length - 1]));
      await context.close();
    }
} finally {
  await browser.close();
}
const report = {
  date: new Date().toISOString().slice(0, 10),
  browser: browserVersion,
  buildId: await readFile(".next/BUILD_ID", "utf8")
    .then((value) => value.trim())
    .catch(() => null),
  environment:
    "Local compiled production bundle; simulated 6x CPU slowdown and 1.6Mbps down/750Kbps up/150ms latency. Not a physical Windows 7 test or public hosting measurement.",
  results,
};
await writeFile(
  `.local/reports/browser-performance-${report.date}.json`,
  JSON.stringify(report, null, 2),
);
