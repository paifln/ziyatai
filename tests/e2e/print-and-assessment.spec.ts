import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

test("assessment objectives require an explicit opt-out and ordinary lessons cannot bypass it", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = [
    { ...plan.rows[0], topic: "СОР № 1", goals: "", goalsSkipped: false },
  ];
  const payload = {
    revision: plan.revision,
    rows,
    grade: 7,
    schoolYear: "2026–2027",
  };
  expect(
    (
      await request.post(`/api/ktp/${plan.id}/confirm`, {
        headers,
        data: payload,
      })
    ).status(),
  ).toBe(422);
  const saved = await request.patch(`/api/ktp/${plan.id}/rows`, {
    headers,
    data: payload,
  });
  expect(saved.ok()).toBe(true);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  await page
    .getByRole("button", { name: "Без целей · СОР/СОЧ", exact: true })
    .click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows[0]
          .goalsSkipped,
    )
    .toBe(true);
  const reread = await (await request.get(`/api/ktp/${plan.id}`)).json();
  const confirmed = await request.post(`/api/ktp/${plan.id}/confirm`, {
    headers,
    data: { ...payload, revision: reread.revision, rows: reread.rows },
  });
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  const current = await (await request.get(`/api/ktp/${plan.id}`)).json();
  expect(
    (
      await request.post(`/api/ktp/${plan.id}/confirm`, {
        headers,
        data: {
          ...payload,
          revision: current.revision,
          rows: [{ ...current.rows[0], topic: "Сортировка" }],
        },
      })
    ).status(),
  ).toBe(422);
});

test("code stays readable in both themes and the selected landscape layout reaches the export API", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const path = `/api/generations/${demo.id}`;
  const generation = await (await request.get(path)).json();
  generation.document.tasks[0].contentBlocks.push({
    type: "code",
    text: "print(42)",
    language: "python",
    items: [],
    columns: [],
    rows: [],
  });
  const edit = await request.patch(`${path}/document`, {
    headers,
    data: { revision: generation.revision, document: generation.document },
  });
  expect(edit.ok()).toBe(true);
  const { revision } = await edit.json();
  expect(
    (
      await request.post(`${path}/approve`, {
        headers,
        data: { revision, teacherReviewed: true },
      })
    ).ok(),
  ).toBe(true);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/?generation=${demo.id}`);
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const code = page.locator(".preview-block pre").first();
    await expect(code).toBeVisible();
    const contrast = await code.evaluate((el) => {
      const luminance = (colour: string) => {
        const rgb = (colour.match(/[\d.]+/g) || [])
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const style = getComputedStyle(el),
        a = luminance(style.color),
        b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await code.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/oct17/code-${theme}.png` });
  }
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Макет", exact: true }).click();
  await expect(page.locator(".preview-paper pre").first()).toHaveCSS(
    "color",
    "rgb(36, 60, 48)",
  );
  await page
    .getByRole("combobox", { name: "Макет печати", exact: true })
    .selectOption("landscape-columns");
  await page.route("**/api/exports", async (route) => {
    expect(route.request().postDataJSON().styles.layout).toBe(
      "landscape-columns",
    );
    await route.fulfill({
      status: 422,
      json: {
        error: {
          code: "RENDER_UNAVAILABLE",
          message: "QA: export payload checked",
        },
      },
    });
  });
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/exports") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  expect((await sent).postDataJSON().styles.layout).toBe("landscape-columns");
});
