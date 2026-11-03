import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { syntheticDemo } from "../../packages/domain/demo";
import { browserStyles } from "./styles";
import AxeBuilder from "@axe-core/playwright";

for (const locale of ["ru", "kk"] as const) {
  test(`task review filters preserve numbering and student view hides teacher content (${locale})`, async ({
    page,
  }) => {
    const sampleDocument = syntheticDemo(locale).document;
    sampleDocument.tasks[0].contentBlocks.push({
      ...sampleDocument.tasks[0].contentBlocks[0],
      type: "code",
      text: "print('lesson')",
      language: "python",
    });
    const bundle = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { TaskReview } from './apps/web/components/generations/TaskReview';
          import { dictionary } from './apps/web/lib/i18n';
          createRoot(document.getElementById('root')).render(
            <TaskReview document={${JSON.stringify(sampleDocument)}} t={dictionary.${locale}}
              locale="${locale}" minutes={5} onEditTask={() => {}} onRegenerate={() => {}} />
          );`,
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
    await page.setContent(
      `<html lang="${locale}"><head><title>Task review</title></head><body><main style="padding:16px;max-width:1100px;margin:auto"><h1>Task review</h1><div id="root"></div></main></body></html>`,
    );
    for (const path of ["app/globals.css", "app/theme.css", "app/review.css"]) {
      await page.addStyleTag({ content: await browserStyles(path) });
    }
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const cards = page.locator(".task-review-card");
    await expect(cards).toHaveCount(9);
    await expect(page.locator(".task-time-over")).toHaveCount(3);
    await expect(page.locator(".task-workload-grid > div")).toHaveCount(3);
    await page.getByRole("combobox").selectOption("advanced");
    await expect(cards).toHaveCount(3);
    await expect(cards.first().getByRole("heading", { level: 2 })).toHaveText(
      `${locale === "ru" ? "Задание" : "Тапсырма"} 7`,
    );
    await cards.first().locator("summary").click();
    await expect(cards.first().locator(".review-answer-content")).toBeVisible();
    const student = page.getByRole("button", {
      name: locale === "ru" ? "Просмотр ученика" : "Оқушы көрінісі",
    });
    await student.click();
    await expect(student).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".review-answer")).toHaveCount(0);
    await expect(page.locator(".review-task-actions")).toHaveCount(0);
    await expect(cards.first().locator(".preview-block")).toBeVisible();
    await student.click();
    await expect(page.locator(".review-answer")).toHaveCount(3);
    await expect(page.locator(".review-answer-content")).toHaveCount(0);
    await page.getByRole("combobox").selectOption("all");
    await expect(cards).toHaveCount(9);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.setViewportSize({ width: 360, height: 780 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
    }
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".task-review-controls")).toBeHidden();
    await expect(page.locator(".task-workload")).toBeHidden();
    await expect(cards.first().locator("pre")).toHaveCSS(
      "color",
      "rgb(36, 60, 48)",
    );
    await expect(cards.first().locator("pre")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
  });
}
