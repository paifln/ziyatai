import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { headers, verifiedUser } from "./helpers";
import { compactPlanDraft } from "../../packages/domain/draft-payload";

for (const editor of ["main", "lite"] as const) {
  test(`${editor} backs up a 2000-row KTP with a compact request and preserves edits made during the first write`, async ({
    page,
    request,
  }) => {
    await verifiedUser(request);
    const demo = await (
      await request.post("/api/demo", { headers, data: { locale: "ru" } })
    ).json();
    const current = await (await request.get(`/api/ktp/${demo.planId}`)).json();
    const settings = parseEnv(await readFile(".env.local", "utf8"));
    const pool = new Pool({ connectionString: settings.DATABASE_URL });
    const rows = Array.from({ length: 2000 }, (_, index) => ({
      ...current.rows[0],
      id: randomUUID(),
      sourceOrder: index + 1,
      topic: `Линейные уравнения ${index + 1}`,
      notes: "",
      goals: "Решать линейные уравнения и проверять найденные решения. ".repeat(
        3,
      ),
      source: { ...current.rows[0].source, fragment: "Линейные уравнения" },
    }));
    try {
      await pool.query(
        "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version,grade,school_year) VALUES($1,$2,$3,$4,'synthetic-payload-qa',7,'2026–2027')",
        [randomUUID(), demo.planId, current.revision + 1, JSON.stringify(rows)],
      );
      await pool.query("UPDATE plans SET revision=$2 WHERE id=$1", [
        demo.planId,
        current.revision + 1,
      ]);
      await page.context().addCookies((await request.storageState()).cookies);
      await page.goto(editor === "main" ? "/" : "/lite/");
      if (editor === "main") {
        await page.getByRole("button", { name: "РУС", exact: true }).click();
        await page
          .locator(".resource-text")
          .filter({ hasText: "DEMO" })
          .click();
      } else {
        if ((await page.locator("#language").textContent()) === "Русский")
          await page.locator("#language").click();
        await page
          .getByRole("button", { name: "Открыть", exact: true })
          .click();
      }
      const field =
        editor === "main"
          ? page.getByLabel("Тема урока 1", { exact: true })
          : page.getByLabel("Тема урока", { exact: true }).first();
      const writes: { id: string; bytes: number; references: number }[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/drafts", async (route) => {
        const input = route.request().postDataJSON();
        expect(input.draft.encoding).toBe("row-references-v1");
        writes.push({
          id: input.id,
          bytes: Buffer.byteLength(route.request().postData()!),
          references: input.draft.rows.filter(
            (row: unknown) => typeof row === "string",
          ).length,
        });
        const response = await route.fetch();
        if (writes.length === 1) await gate;
        await route.fulfill({ response });
      });
      try {
        await field.fill("Первая правка большого КТП");
        await expect.poll(() => writes.length).toBe(1);
        await field.fill("Последняя правка во время медленного сохранения");
        release();
        await expect.poll(() => writes.length).toBe(2);
        await expect(
          page.locator(".draft-recovery").getByRole("status"),
        ).toContainText("Резервный черновик сохранён в аккаунте");
        const stored = await (
          await request.get(`/api/drafts/${writes[1].id}`)
        ).json();
        expect(stored.draft.rows).toHaveLength(2000);
        expect(stored.draft.rows[0].topic).toBe(
          "Последняя правка во время медленного сохранения",
        );
        expect(stored.draft.rows.slice(1)).toEqual(rows.slice(1));
        expect(stored.base.rows[0].topic).toBe(rows[0].topic);
        const fullBytes = Buffer.byteLength(
          JSON.stringify({ ...stored.draft, rows }),
        );
        expect(writes.every((write) => write.references === 1999)).toBe(true);
        expect(writes.every((write) => write.bytes < fullBytes * 0.1)).toBe(
          true,
        );
        const unchanged = await (
          await request.get(`/api/ktp/${demo.planId}`)
        ).json();
        expect(unchanged.rows[0].topic).toBe(rows[0].topic);
        await mkdir(".local/qa", { recursive: true });
        await writeFile(
          `.local/qa/draft-payload-${editor}.json`,
          JSON.stringify(
            {
              editor,
              rows: 2000,
              fullDraftBytes: fullBytes,
              writes,
              reductionPercent: 100 * (1 - writes[1].bytes / fullBytes),
              limitations:
                "Local synthetic data and host; no physical low-end device performance claim",
            },
            null,
            2,
          ),
        );
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    } finally {
      await pool.end();
    }
  });
}

test("compact drafts resolve against the owned historical revision and reject invalid references and duplicate rows", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  let current = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  expect(
    (
      await request.patch(`/api/ktp/${demo.planId}/rows`, {
        headers,
        data: {
          revision: current.revision,
          grade: current.grade,
          schoolYear: current.school_year ?? "",
          rows: [
            ...current.rows,
            { ...current.rows[0], id: randomUUID(), sourceOrder: 2 },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  current = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const base = {
    rows: current.rows,
    grade: current.grade,
    schoolYear: current.school_year ?? "",
  };
  const local = structuredClone(base);
  local.rows[0].topic = "Мой локальный вариант";
  const remote = structuredClone(base);
  remote.rows[1].notes = "Новая серверная правка";
  expect(
    (
      await request.patch(`/api/ktp/${demo.planId}/rows`, {
        headers,
        data: { revision: current.revision, ...remote },
      })
    ).status(),
  ).toBe(200);
  const input = {
    id: randomUUID(),
    kind: "ktp",
    resourceId: demo.planId,
    baseRevision: current.revision,
    sequence: 1,
    draft: compactPlanDraft(base, local),
  };
  expect("encoding" in input.draft).toBe(true);
  expect(
    (await request.post("/api/drafts", { headers, data: input })).status(),
  ).toBe(200);
  const stored = await (await request.get(`/api/drafts/${input.id}`)).json();
  expect(stored.draft).toEqual(local);
  expect(stored.base).toEqual(base);
  for (const invalid of [
    [randomUUID()],
    [base.rows[0].id, base.rows[0].id],
    ["__proto__"],
  ])
    expect(
      (
        await request.post("/api/drafts", {
          headers,
          data: {
            ...input,
            id: randomUUID(),
            draft: {
              encoding: "row-references-v1",
              grade: base.grade,
              schoolYear: base.schoolYear,
              rows: invalid,
            },
          },
        })
      ).status(),
    ).toBe(422);
  expect(
    (
      await request.post("/api/drafts", {
        headers: { Origin: "https://attacker.example" },
        data: input,
      })
    ).status(),
  ).toBe(403);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  try {
    await verifiedUser(other);
    expect(
      (
        await other.post("/api/drafts", {
          headers,
          data: { ...input, id: randomUUID() },
        })
      ).status(),
    ).toBe(404);
    expect((await other.get(`/api/drafts/${input.id}`)).status()).toBe(404);
  } finally {
    await other.dispose();
  }
});

test("compact requests cannot bypass the expanded draft size allowance", async ({
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const current = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  try {
    const row = {
      ...current.rows[0],
      source: {
        ...current.rows[0].source,
        fragment: "X".repeat(2 * 1024 * 1024),
      },
    };
    await pool.query(
      "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version,grade,school_year) VALUES($1,$2,$3,$4,'synthetic-budget-qa',7,'2026–2027')",
      [randomUUID(), demo.planId, current.revision + 1, JSON.stringify([row])],
    );
    const id = randomUUID();
    for (const draft of [
      {
        encoding: "row-references-v1",
        rows: [row.id],
        grade: 7,
        schoolYear: "2026–2027",
      },
      { rows: [row], grade: 7, schoolYear: "2026–2027" },
    ]) {
      const response = await request.post("/api/drafts", {
        headers,
        data: {
          id,
          kind: "ktp",
          resourceId: demo.planId,
          baseRevision: current.revision + 1,
          sequence: 1,
          draft,
        },
      });
      expect(response.status()).toBe(413);
      expect((await response.json()).code).toBe("DRAFT_SIZE");
    }
    expect((await request.get(`/api/drafts/${id}`)).status()).toBe(404);
  } finally {
    await pool.end();
  }
});
