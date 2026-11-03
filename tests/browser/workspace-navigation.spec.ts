import { test, expect } from "@playwright/test";
import { build } from "esbuild";
test("reload, Back and Forward preserve the workspace; cancelled Back preserves edits", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import {useState,useCallback} from 'react';import{createRoot}from'react-dom/client';import{useWorkspaceNavigation}from'./apps/web/lib/use-workspace-navigation';
function App(){const[dirty,setDirty]=useState(false);const confirm=useCallback(async()=>window.confirm('Discard?'),[]);const changed=useCallback(()=>setDirty(false),[]);const n=useWorkspaceNavigation(dirty,confirm,changed);return <main><h1>{n.location.view}</h1><button onClick={()=>n.navigate({view:'history',id:''})}>History</button><button onClick={()=>n.navigate({view:'library',id:''})}>Library</button><label>Unsaved<input type="checkbox" checked={dirty} onChange={e=>setDirty(e.target.checked)}/></label></main>}createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const origin = "http://localhost:3199";
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html lang="en"><head><title>Navigation</title></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page).toHaveURL(`${origin}/?view=history`);
  await page.reload();
  await expect(page.getByRole("heading")).toHaveText("history");
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByRole("heading")).toHaveText("library");
  await page.getByRole("checkbox").check();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/?view=library`);
  await expect(page.getByRole("checkbox")).toBeChecked();
  page.once("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await expect(page.getByRole("heading")).toHaveText("history");
  await page.goForward();
  await expect(page.getByRole("heading")).toHaveText("library");
});
