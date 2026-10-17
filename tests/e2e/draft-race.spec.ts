import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

test("a delayed old autosave cannot resurrect a completed draft or replace the next edit", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  const field = page.getByLabel("Тема урока 1", { exact: true });
  let release!: () => void,
    draftId = "",
    lateStatus = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/drafts",
    async (route) => {
      draftId = route.request().postDataJSON().id;
      await gate;
      const response = await route.fetch();
      lateStatus = response.status();
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    await field.fill("Правка, которую сохраняем обычной кнопкой");
    await expect.poll(() => draftId).not.toBe("");
    const discarded = page.waitForResponse((response) =>
      response.url().endsWith(`/api/drafts/${draftId}/discard`),
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    expect((await discarded).status()).toBe(200);
    await expect(field).toBeEnabled();
    await field.fill("Следующая независимая правка");
    await expect(
      page.locator(".draft-recovery").getByRole("status"),
    ).toContainText("Резервный черновик сохранён в аккаунте");
    release();
    await expect.poll(() => lateStatus).toBe(409);
    const copies = await (
      await request.get(`/api/drafts?kind=ktp&resourceId=${demo.planId}`)
    ).json();
    expect(copies).toHaveLength(1);
    expect(copies[0].id).not.toBe(draftId);
    expect(
      (await (await request.get(`/api/drafts/${copies[0].id}`)).json()).draft
        .rows[0].topic,
    ).toBe("Следующая независимая правка");
    expect(
      (await (await request.get(`/api/ktp/${demo.planId}`)).json()).rows[0]
        .topic,
    ).toBe("Правка, которую сохраняем обычной кнопкой");
    await expect(field).toHaveValue("Следующая независимая правка");
    await expect(page.locator(".global-error")).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
