import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("a late session read cannot restore the account invalidated by another tab", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client'; import {authClient} from './apps/web/lib/auth/client'; function View(){ const state=authClient.useSession(); return <p>{state.isPending?'pending':state.data?.user.id??'guest'}</p> } createRoot(document.getElementById('root')).render(<View/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  let reads = 0;
  await page.route("http://localhost:3199/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/auth/get-session") {
      reads++;
      const first = reads === 1;
      if (first) await held;
      return route.fulfill({
        json: { user: { id: first ? "old-owner" : "new-owner" } },
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="root"></div></body></html>',
    });
  });
  await page.goto("http://localhost:3199");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() => {
    (window as any).observedOwners = [];
    new MutationObserver(() =>
      (window as any).observedOwners.push(
        document.querySelector("p")?.textContent,
      ),
    ).observe(document.getElementById("root")!, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.dispatchEvent(
      new StorageEvent("storage", { key: "ziyatai.auth", newValue: "changed" }),
    );
  });
  release();
  await expect(page.locator("p")).toHaveText("new-owner");
  expect(
    await page.evaluate(() => (window as any).observedOwners),
  ).not.toContain("old-owner");
});
