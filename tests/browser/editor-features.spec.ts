import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { syntheticDemo } from "../../packages/domain/demo";
import { dictionary } from "../../apps/web/lib/i18n";

for (const feature of ["generation", "plan"] as const) {
  test(`${feature} editor preserves edits across its extracted sections`, async ({
    page,
  }) => {
    const origin = "http://localhost:3199";
    const id = "00000000-0000-4000-8000-000000000001";
    const sample = syntheticDemo("ru");
    const errors: string[] = [];
    const patches: Record<string, any>[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture =
      feature === "generation"
        ? {
            id,
            title: "Synthetic generation",
            revision: 1,
            status: "needs_review",
            demo: true,
            source_snapshot: sample.snapshot,
            document: sample.document,
            validation: { issues: [] },
          }
        : {
            id,
            title: "Synthetic plan",
            revision: 1,
            status: "confirmed",
            rows: [sample.row],
            grade: 7,
            school_year: "2026–2027",
          };
    const bundle = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
          import Editor from './apps/web/components/${feature === "generation" ? "GenerationEditor" : "PlanReview"}';
          import { AccountClientProvider } from './apps/web/lib/account-client';
          import { ConfirmProvider } from './apps/web/components/ui/ConfirmProvider';
          import { dictionary } from './apps/web/lib/i18n';
          const noop = () => {};
          createRoot(document.getElementById('root')).render(<AccountClientProvider owner="${id}" onSessionChanged={noop}><ConfirmProvider>
            <Editor id="${id}" t={dictionary.ru} locale="ru" jobs={[]} profileStyles={{}} onError={s => { if(s) throw new Error(s); }} onDirtyChange={noop} onSaved={noop} onGenerate={noop} onBack={noop} refresh={async () => {}} />
          </ConfirmProvider></AccountClientProvider>);`,
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
    await page.route(`${origin}/**`, async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div>',
        });
      if (
        url.pathname ===
          `/api/${feature === "generation" ? "generations" : "ktp"}/${id}` &&
        req.method() === "GET"
      )
        return route.fulfill({ json: fixture });
      if (req.method() === "PATCH") {
        patches.push(req.postDataJSON());
        if (feature === "plan")
          Object.assign(fixture, { rows: patches.at(-1)!.rows, revision: 2 });
        return route.fulfill({ json: { revision: 2 } });
      }
      if (url.pathname === "/api/drafts" || url.pathname.endsWith("/versions"))
        return route.fulfill({ json: [] });
      return route.fulfill({
        status: 404,
        json: { code: "unexpected_test_request" },
      });
    });
    await page.goto(origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    if (feature === "generation") {
      await page
        .getByRole("button", { name: "Редактировать", exact: true })
        .click();
      const text = page.locator(".task-card textarea").first();
      await expect(text).toBeVisible();
      await text.fill("Changed synthetic task");
      await page.getByRole("button", { name: "Макет", exact: true }).click();
      await page
        .getByRole("button", { name: "Редактировать", exact: true })
        .click();
      await expect(text).toHaveValue("Changed synthetic task");
      await page
        .getByRole("button", { name: dictionary.ru.save, exact: true })
        .click();
      await expect.poll(() => patches.length).toBe(1);
      expect(patches[0].revision).toBe(1);
      expect(JSON.stringify(patches[0].document)).toContain(
        "Changed synthetic task",
      );
      expect(patches[0].document.tasks).toHaveLength(
        sample.document.tasks.length,
      );
      await expect(
        page.getByRole("button", { name: dictionary.ru.save, exact: true }),
      ).toBeDisabled();
    } else {
      const topic = page.getByRole("textbox", {
        name: `${dictionary.ru.topic} 1`,
        exact: true,
      });
      await expect(
        page.getByRole("button", { name: dictionary.ru.create, exact: true }),
      ).toBeEnabled();
      await topic.fill("Changed synthetic lesson");
      await expect(topic).toHaveValue("Changed synthetic lesson");
      await expect(
        page.getByRole("button", {
          name: dictionary.ru.create,
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: dictionary.ru.save, exact: true })
        .click();
      await expect.poll(() => patches.length).toBe(1);
      expect(patches[0].revision).toBe(1);
      expect(patches[0].rows[0].topic).toBe("Changed synthetic lesson");
      await expect(topic).toHaveValue("Changed synthetic lesson");
    }
    expect(errors).toEqual([]);
  });
}
