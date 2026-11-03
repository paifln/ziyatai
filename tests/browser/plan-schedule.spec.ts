import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { stylesheet } from "./styles";
import AxeBuilder from "@axe-core/playwright";
import { syntheticDemo } from "../../packages/domain/demo";

for (const locale of ["ru", "kk"] as const) {
  test(`schedule follows the school day and selected class without inventing dates (${locale})`, async ({
    page,
  }) => {
    const row = syntheticDemo(locale).row;
    const rows = [
      {
        ...row,
        id: "past-tomorrow",
        grade: 2,
        topic: "Only October 27",
        dateRaw: "27.10.2026",
      },
      {
        ...row,
        id: "future",
        grade: 10,
        topic: "October 28 lesson",
        dateRaw: "28.10.2026",
      },
      {
        ...row,
        id: "range",
        grade: 2,
        topic: "Ongoing range",
        dateRaw: "26.10.2026–29.10.2026",
      },
      { ...row, id: "missing", grade: 2, topic: "No year", dateRaw: "30.10" },
      {
        ...row,
        id: "skipped",
        grade: 10,
        topic: "Skipped",
        dateRaw: "29.10.2026",
        dateSkipped: true,
      },
    ];
    const bundle = await build({
      stdin: {
        contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {PlanSchedule} from './apps/web/components/plans/PlanSchedule';
        function App(){const [grade,setGrade]=useState('');const [selected,setSelected]=useState('');return <>
          <label>Class<select value={grade} onChange={e=>setGrade(e.target.value)}><option value="">All</option><option value="2">2</option><option value="10">10</option></select></label>
          <PlanSchedule rows={${JSON.stringify(rows)}} grade={null} classFilter={grade} locale="${locale}" disabled={false} onOpen={setSelected}/><output>{selected}</output></>}
        createRoot(document.getElementById('root')).render(<App/>);`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    await page.clock.install({ time: new Date("2026-10-27T18:59:30Z") });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.setContent(
      `<html lang="${locale}"><head><title>Schedule</title></head><body><main style="padding:16px"><h1>Schedule</h1><div id="root"></div></main></body></html>`,
    );
    for (const path of ["app/globals.css", "app/theme.css", "app/review.css"])
      await page.addStyleTag({ content: await stylesheet(path) });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator(".plan-schedule > summary").click();
    await expect(page.locator(".plan-schedule-list li")).toHaveCount(3);
    await expect(page.locator(".plan-schedule")).toContainText(
      locale === "ru" ? "Без определённой даты: 2" : "Күні анықталмаған: 2",
    );
    await page.clock.fastForward(60000);
    await expect(page.locator(".plan-schedule-list li")).toHaveCount(2);
    await expect(page.locator(".plan-schedule-list")).not.toContainText(
      "Only October 27",
    );
    await page.getByRole("combobox", { name: "Class" }).selectOption("10");
    await expect(page.locator(".plan-schedule-list li")).toHaveCount(1);
    await page.getByRole("button", { name: /October 28 lesson/ }).click();
    await expect(page.locator("output")).toHaveText("future");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (locale === "ru")
        await page.screenshot({
          path: `.local/qa-schedule-${theme}.png`,
          fullPage: true,
        });
    }
  });
}
