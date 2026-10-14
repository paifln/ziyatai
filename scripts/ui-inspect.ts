import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGE_ERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error")
    console.log("CONSOLE_ERROR", m.text().slice(0, 400));
});
await page.goto("http://localhost:3000");
await page.waitForTimeout(4000);
await mkdir(".local/qa", { recursive: true });
await page.screenshot({ path: ".local/qa/auth-1440.png", fullPage: true });
console.log(
  "PAGE_TEXT",
  (await page.locator("body").innerText()).slice(0, 700),
);
await browser.close();
