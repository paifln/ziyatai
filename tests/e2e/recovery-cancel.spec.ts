import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

type Kind = "ktp" | "generation";
async function setup(page: Page, request: APIRequestContext, kind: Kind) {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const resourceId = kind === "ktp" ? demo.planId : demo.id;
  const endpoint = `/api/${kind === "ktp" ? "ktp" : "generations"}/${resourceId}`;
  const current = await (await request.get(endpoint)).json();
  const draft =
    kind === "ktp"
      ? {
          rows: current.rows,
          grade: current.grade,
          schoolYear: current.school_year ?? "",
        }
      : current.document;
  if (kind === "ktp") draft.rows[0].topic = "Тема из резервной копии";
  else draft.tasks[0].contentBlocks[0].text = "Условие из резервной копии";
  const id = randomUUID();
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: {
          id,
          kind,
          resourceId,
          baseRevision: current.revision,
          sequence: 1,
          draft,
        },
      })
    ).status(),
  ).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(kind === "ktp" ? "/" : `/?generation=${resourceId}`);
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  if (kind === "ktp")
    await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  else
    await page
      .getByRole("button", { name: "Доработать задание 1", exact: true })
      .click();
  const field =
    kind === "ktp"
      ? page.getByLabel("Тема урока 1", { exact: true })
      : page
          .locator(".task-card")
          .first()
          .getByLabel("Текст", { exact: true })
          .first();
  const backup = page.locator(".draft-recovery");
  const restore = backup.getByRole("button", {
    name: "Восстановить черновик",
    exact: true,
  });
  await expect(restore).toBeVisible();
  return { id, endpoint, current, field, backup, restore };
}

for (const kind of ["ktp", "generation"] as const) {
  test(`${kind}: cancel delayed recovery keeps live edits and does not consume the cancelled copy`, async ({
    page,
    request,
  }) => {
    const data = await setup(page, request, kind);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    await page.route(`**/api/drafts/${data.id}`, async (route) => {
      const response = await route.fetch();
      started = true;
      await gate;
      await route.fulfill({ response });
    });
    try {
      await data.restore.click();
      await expect.poll(() => started).toBe(true);
      const cancel = data.backup.getByRole("button", {
        name: "Отменить восстановление",
        exact: true,
      });
      await expect(cancel).toBeVisible();
      await expect(cancel).toBeFocused();
      await expect(data.field).toBeDisabled();
      await page.setViewportSize({ width: 360, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => document.documentElement.setAttribute("data-theme", value),
          theme,
        );
        expect(
          (await new AxeBuilder({ page }).include(".draft-recovery").analyze())
            .violations,
        ).toEqual([]);
        await page.screenshot({
          path: `.local/qa/${kind}-cancel-recovery-${theme}.png`,
        });
      }
      if (kind === "generation") await data.backup.locator("summary").click();
      await cancel.click();
      await expect(cancel).toHaveCount(0);
      await expect(
        kind === "generation" ? data.backup.locator("summary") : data.restore,
      ).toBeFocused();
      await expect(data.field).toBeEnabled();
      await data.field.fill("Моя правка после отмены восстановления");
      release();
      await page.unrouteAll({ behavior: "wait" });
      await expect(data.field).toHaveValue(
        "Моя правка после отмены восстановления",
      );
      await expect(page.locator(".revision-conflict")).toHaveCount(0);
      await expect(data.backup.getByRole("alert")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await request.get(data.endpoint)).json()).revision,
        )
        .toBe(data.current.revision + 1);
      const saved = await (await request.get(data.endpoint)).json();
      expect(
        kind === "ktp"
          ? saved.rows[0].topic
          : saved.document.tasks[0].contentBlocks[0].text,
      ).toBe("Моя правка после отмены восстановления");
      expect((await request.get(`/api/drafts/${data.id}`)).status()).toBe(200);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  test(`${kind}: a cancelled old read cannot end a newer recovery operation`, async ({
    page,
    request,
  }) => {
    const data = await setup(page, request, kind);
    const release: (() => void)[] = [];
    const gates = [0, 1].map(
      () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
    );
    let reads = 0;
    await page.route(`**/api/drafts/${data.id}`, async (route) => {
      const index = reads++;
      const response = await route.fetch();
      if (index < 2) await gates[index];
      await route.fulfill({ response });
    });
    try {
      await data.restore.click();
      await expect.poll(() => reads).toBe(1);
      const cancel = data.backup.getByRole("button", {
        name: "Отменить восстановление",
        exact: true,
      });
      await cancel.click();
      await data.restore.click();
      await expect.poll(() => reads).toBe(2);
      release[0]();
      await expect(cancel).toBeVisible();
      await expect(data.field).toBeDisabled();
      release[1]();
      await expect(page.locator(".revision-conflict")).toBeVisible();
      await expect(cancel).toHaveCount(0);
      await page
        .locator(".revision-conflict")
        .getByRole("button", { name: "Применить объединение", exact: true })
        .click();
      await expect(data.field).toHaveValue(
        kind === "ktp"
          ? "Тема из резервной копии"
          : "Условие из резервной копии",
      );
      expect((await (await request.get(data.endpoint)).json()).revision).toBe(
        data.current.revision,
      );
    } finally {
      release.forEach((done) => done());
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  test(`${kind}: failed recovery unlocks the editor and navigation aborts its later retry`, async ({
    page,
    request,
  }) => {
    const data = await setup(page, request, kind);
    let failing = true,
      reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/drafts/${data.id}`, async (route) => {
      reads++;
      if (failing) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "INTERNAL" }),
        });
      } else {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      }
    });
    try {
      await data.restore.click();
      await expect(data.backup.getByRole("alert")).toBeVisible();
      expect(reads).toBe(3);
      await expect(data.field).toBeEnabled();
      await expect(data.restore).toBeEnabled();
      await expect(data.restore).toBeFocused();
      await expect(
        data.backup.getByRole("button", {
          name: "Отменить восстановление",
          exact: true,
        }),
      ).toHaveCount(0);
      failing = false;
      await data.restore.click();
      await expect.poll(() => reads).toBe(4);
      await page
        .locator(".sidebar")
        .getByRole("button", { name: "Мои КТП", exact: true })
        .click();
      release();
      await page.unrouteAll({ behavior: "wait" });
      await expect(
        page.locator(".resource-text").filter({ hasText: "DEMO" }),
      ).toBeVisible();
      await expect(page.locator(".revision-conflict")).toHaveCount(0);
      await expect(data.backup).toHaveCount(0);
      expect((await request.get(`/api/drafts/${data.id}`)).status()).toBe(200);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
