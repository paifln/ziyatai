import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser } from "./helpers";

test("Lite dark print uses white paper and readable code and excludes private recovery controls", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const generation = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  generation.document.tasks[0].contentBlocks = [
    {
      type: "code",
      text: "print(2 + 3)",
      language: "python",
      items: [],
      columns: [],
      rows: [],
    },
  ];
  const saved = await request.patch(`/api/generations/${demo.id}/document`, {
    headers,
    data: { revision: generation.revision, document: generation.document },
  });
  expect(saved.status()).toBe(200);
  const revision = (await saved.json()).revision;
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: {
          id: randomUUID(),
          kind: "generation",
          resourceId: demo.id,
          baseRevision: revision,
          sequence: 1,
          draft: generation.document,
        },
      })
    ).status(),
  ).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/lite/?generation=${demo.id}`);
  if ((await page.locator("#language").textContent()) === "Русский")
    await page.locator("#language").click();
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  const backup = page.locator(".draft-recovery"),
    code = page.locator(".task pre").first();
  await expect(code).toHaveText("print(2 + 3)");
  await expect(
    backup.getByRole("button", { name: "Восстановить черновик", exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(backup).toBeHidden();
  const colors = await page.evaluate(() =>
    [document.body, document.querySelector(".task pre")!].map((element) => {
      const style = getComputedStyle(element);
      return {
        bg: style.backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number),
        ink: style.color.match(/\d+/g)!.slice(0, 3).map(Number),
      };
    }),
  );
  for (const color of colors) {
    expect(color.bg.every((v) => v >= 245)).toBe(true);
    expect(color.ink.every((v) => v <= 100)).toBe(true);
  }
  await page.emulateMedia({ media: "screen" });
  await backup
    .getByRole("button", { name: "Восстановить черновик", exact: true })
    .click();
  await expect(page.locator(".draft-conflict")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".draft-conflict")).toBeHidden();
});
