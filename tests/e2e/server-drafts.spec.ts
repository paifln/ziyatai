import { origin as qaOrigin } from "./helpers";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import AxeBuilder from "@axe-core/playwright";
import { headers, verifiedUser } from "./helpers";

type Kind = "ktp" | "generation";
async function setup(request: APIRequestContext, kind: Kind) {
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
  return { demo, resourceId, endpoint, current, draft };
}
async function open(
  page: Page,
  request: APIRequestContext,
  kind: Kind,
  data: Awaited<ReturnType<typeof setup>>,
) {
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(kind === "ktp" ? "/" : `/?generation=${data.resourceId}`);
  await page.getByRole("button", { name: "РУС", exact: true }).click();
  if (kind === "ktp")
    await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
  else
    await page
      .getByRole("button", { name: "Доработать задание 1", exact: true })
      .click();
  return kind === "ktp"
    ? page.getByLabel("Тема урока 1", { exact: true })
    : page
        .locator(".task-card")
        .first()
        .getByLabel("Текст", { exact: true })
        .first();
}
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("server drafts enforce ownership, CSRF, monotonic updates and discard tombstones", async ({
  request,
  playwright,
}) => {
  const data = await setup(request, "ktp");
  const id = randomUUID(),
    input = {
      id,
      kind: "ktp",
      resourceId: data.resourceId,
      baseRevision: data.current.revision,
      sequence: 1,
      draft: data.draft,
    };
  data.draft.rows[0].topic = "Приватный резервный черновик";
  const write = await request.post("/api/drafts", { headers, data: input });
  expect(write.status(), await write.text()).toBe(200);
  expect(write.headers()["cache-control"]).toContain("no-store");
  const meta = await write.json();
  expect(Date.parse(meta.expiresAt) - Date.parse(meta.savedAt)).toBeGreaterThan(
    7 * 86400000 - 2000,
  );
  expect(Date.parse(meta.expiresAt) - Date.parse(meta.savedAt)).toBeLessThan(
    7 * 86400000 + 2000,
  );
  const stored = await (await request.get(`/api/drafts/${id}`)).json();
  expect(stored.draft.rows[0].topic).toBe("Приватный резервный черновик");
  expect(stored.base.rows[0].topic).not.toBe("Приватный резервный черновик");
  expect((await (await request.get(data.endpoint)).json()).revision).toBe(
    data.current.revision,
  );
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    expect((await other.get(`/api/drafts/${id}`)).status()).toBe(401);
    const otherData = await setup(other, "ktp");
    expect((await other.get(`/api/drafts/${id}`)).status()).toBe(404);
    expect(
      (
        await other.get(`/api/drafts?kind=ktp&resourceId=${data.resourceId}`)
      ).status(),
    ).toBe(404);
    expect(
      (await other.post("/api/drafts", { headers, data: input })).status(),
    ).toBe(404);
    expect(
      (
        await other.post(`/api/drafts/${id}/discard`, {
          headers,
          data: { kind: "ktp", resourceId: otherData.resourceId },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.post("/api/drafts", {
          headers,
          data: {
            ...input,
            resourceId: otherData.resourceId,
            draft: otherData.draft,
          },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await other.dispose();
  }
  expect(
    (
      await request.post("/api/drafts", {
        headers: { Origin: "https://attacker.example" },
        data: input,
      })
    ).status(),
  ).toBe(403);
  data.draft.rows[0].topic = "Новейшая резервная копия";
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: { ...input, sequence: 2 },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await request.post("/api/drafts", { headers, data: input })).status(),
  ).toBe(409);
  expect(
    (await (await request.get(`/api/drafts/${id}`)).json()).draft.rows[0].topic,
  ).toBe("Новейшая резервная копия");
  expect(
    (
      await request.post(`/api/drafts/${id}/discard`, {
        headers,
        data: { kind: "ktp", resourceId: data.resourceId, expectedSequence: 1 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/drafts/${id}/discard`, {
        headers,
        data: { kind: "ktp", resourceId: data.resourceId, expectedSequence: 2 },
      })
    ).status(),
  ).toBe(200);
  expect((await request.get(`/api/drafts/${id}`)).status()).toBe(404);
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: { ...input, sequence: 3 },
      })
    ).status(),
  ).toBe(409);
  const pendingId = randomUUID();
  expect(
    (
      await request.post(`/api/drafts/${pendingId}/discard`, {
        headers,
        data: { kind: "ktp", resourceId: data.resourceId },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: { ...input, id: pendingId },
      })
    ).status(),
  ).toBe(409);
});

test("expired draft payloads are hidden and cleaned, and account deletion removes active copies", async ({
  request,
}) => {
  const environment = parseEnv(await readFile(".env.local", "utf8"));
  test.skip(
    environment.APP_ENV !== "local",
    "Physical expiry check is scoped to local synthetic data",
  );
  const data = await setup(request, "ktp");
  const owner = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1 });
  const input = {
    id: randomUUID(),
    kind: "ktp",
    resourceId: data.resourceId,
    baseRevision: data.current.revision,
    sequence: 1,
    draft: data.draft,
  };
  try {
    expect(
      (await request.post("/api/drafts", { headers, data: input })).status(),
    ).toBe(200);
    const activeId = randomUUID();
    expect(
      (
        await request.post("/api/drafts", {
          headers,
          data: { ...input, id: activeId },
        })
      ).status(),
    ).toBe(200);
    await pool.query(
      "UPDATE editor_drafts SET expires_at=now()-interval '1 second' WHERE id=$1 AND owner_id=$2",
      [input.id, owner],
    );
    expect((await request.get(`/api/drafts/${input.id}`)).status()).toBe(404);
    expect(
      await (
        await request.get(`/api/drafts?kind=ktp&resourceId=${data.resourceId}`)
      ).json(),
    ).toHaveLength(1);
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM editor_drafts WHERE id=$1 AND owner_id=$2",
              [input.id, owner],
            )
          ).rows[0].count,
        { timeout: 45000, intervals: [1000, 2000, 5000] },
      )
      .toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM editor_drafts WHERE id=$1 AND owner_id=$2",
          [activeId, owner],
        )
      ).rows[0].count,
    ).toBe(1);
    expect((await request.delete("/api/account", { headers })).status()).toBe(
      200,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM editor_drafts WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await pool.end();
  }
});

test("draft storage bounds count and bodies and validates the canonical baseline", async ({
  request,
}) => {
  const data = await setup(request, "generation");
  const input = {
    id: randomUUID(),
    kind: "generation",
    resourceId: data.resourceId,
    baseRevision: data.current.revision,
    sequence: 1,
    draft: data.draft,
  };
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: { ...input, baseRevision: 999999 },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: {
          ...input,
          draft: { ...data.draft, sourceSnapshotId: "another-document" },
        },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: {
          ...input,
          draft: { ...data.draft, title: "x".repeat(2 * 1024 * 1024) },
        },
      })
    ).status(),
  ).toBe(413);
  for (let i = 0; i < 20; i++)
    expect(
      (
        await request.post("/api/drafts", {
          headers,
          data: { ...input, id: randomUUID() },
        })
      ).status(),
    ).toBe(200);
  expect(
    (
      await request.post("/api/drafts", {
        headers,
        data: { ...input, id: randomUUID() },
      })
    ).status(),
  ).toBe(429);
  expect(
    await (
      await request.get(
        `/api/drafts?kind=generation&resourceId=${data.resourceId}`,
      )
    ).json(),
  ).toHaveLength(20);
  expect((await (await request.get(data.endpoint)).json()).revision).toBe(
    data.current.revision,
  );
});

for (const kind of ["ktp", "generation"] as const) {
  test(`${kind}: account backup survives reload and reconciles with a newer material before explicit save`, async ({
    page,
    request,
  }) => {
    const data = await setup(request, kind);
    if (kind === "ktp")
      await page.addInitScript(() => {
        Storage.prototype.setItem = function () {
          throw new DOMException(
            "Browser storage is disabled",
            "QuotaExceededError",
          );
        };
      });
    let field = await open(page, request, kind, data);
    await field.fill("Незаконченная работа до перезагрузки");
    const backup = page.locator(".draft-recovery");
    await expect(backup.getByRole("status")).toContainText(
      "Резервный черновик сохранён в аккаунте",
    );
    expect((await (await request.get(data.endpoint)).json()).revision).toBe(
      data.current.revision,
    );
    const list = await (
      await request.get(
        `/api/drafts?kind=${kind}&resourceId=${data.resourceId}`,
      )
    ).json();
    expect(list).toHaveLength(1);
    const other = await (await request.get(data.endpoint)).json();
    if (kind === "ktp")
      other.rows[0].notes = "Правка другой вкладки после резервного сохранения";
    else
      other.document.tasks[0].explanationWhy =
        "Правка другой вкладки после резервного сохранения";
    expect(
      (
        await request.patch(
          `${data.endpoint}/${kind === "ktp" ? "rows" : "document"}`,
          {
            headers,
            data:
              kind === "ktp"
                ? {
                    revision: other.revision,
                    rows: other.rows,
                    grade: other.grade,
                    schoolYear: other.school_year ?? "",
                  }
                : { revision: other.revision, document: other.document },
          },
        )
      ).status(),
    ).toBe(200);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload();
    if (kind === "ktp")
      await page.locator(".resource-text").filter({ hasText: "DEMO" }).click();
    const restore = backup.getByRole("button", {
      name: "Восстановить черновик",
      exact: true,
    });
    await expect(restore).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    if (kind === "ktp")
      await page.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "dark"),
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".draft-recovery").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `.local/qa/${kind}-backup-recovery.png` });
    await restore.click();
    const comparison = page.locator(".revision-conflict");
    await expect(comparison).toBeVisible();
    await comparison
      .getByRole("button", { name: "Применить объединение", exact: true })
      .click();
    if (kind === "generation")
      await page
        .getByRole("button", { name: "Доработать задание 1", exact: true })
        .click();
    field =
      kind === "ktp"
        ? page.getByLabel("Тема урока 1", { exact: true })
        : page
            .locator(".task-card")
            .first()
            .getByLabel("Текст", { exact: true })
            .first();
    await expect(field).toHaveValue("Незаконченная работа до перезагрузки");
    expect((await (await request.get(data.endpoint)).json()).revision).toBe(
      data.current.revision + 1,
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () => (await (await request.get(data.endpoint)).json()).revision,
      )
      .toBe(data.current.revision + 2);
    const saved = await (await request.get(data.endpoint)).json();
    expect(
      kind === "ktp"
        ? saved.rows[0].notes
        : saved.document.tasks[0].explanationWhy,
    ).toBe("Правка другой вкладки после резервного сохранения");
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(
                `/api/drafts?kind=${kind}&resourceId=${data.resourceId}`,
              )
            ).json()
          ).length,
      )
      .toBe(0);
    expect(
      await page.evaluate(() =>
        [localStorage, sessionStorage]
          .flatMap((storage) =>
            Object.keys(storage).map((key) => storage.getItem(key)),
          )
          .join(" "),
      ),
    ).not.toContain("Незаконченная работа");
  });
}

test("failed autosave preserves the live draft, never claims a saved backup and can retry", async ({
  page,
  request,
}) => {
  const data = await setup(request, "ktp");
  const field = await open(page, request, "ktp", data);
  let writes = 0;
  await page.route("**/api/drafts", (route) => {
    writes++;
    return route.abort("connectionfailed");
  });
  await field.fill("Правка во время обрыва связи");
  const backup = page.locator(".draft-recovery");
  await expect(backup.getByRole("status")).toContainText(
    "Резервный черновик не обновлён",
  );
  await expect(field).toHaveValue("Правка во время обрыва связи");
  expect(writes).toBe(1);
  expect(
    await (
      await request.get(`/api/drafts?kind=ktp&resourceId=${data.resourceId}`)
    ).json(),
  ).toHaveLength(0);
  await page.unroute("**/api/drafts");
  await backup.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(backup.getByRole("status")).toContainText(
    "Резервный черновик сохранён в аккаунте",
  );
});
