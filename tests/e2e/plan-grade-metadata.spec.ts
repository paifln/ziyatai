import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { headers, verifiedUser } from "./helpers";
import { backfillPlanGrades } from "../../scripts/data-migrations/plan-grades";

test("multi-class metadata follows saved rows and collection filters without exposing lessons", async ({
  page,
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const rows = [2, 10, 2].map((grade, index) => ({
    ...plan.rows[0],
    id: randomUUID(),
    sourceOrder: index + 1,
    grade,
  }));
  const saved = await request.patch(`/api/ktp/${plan.id}/rows`, {
    headers,
    data: {
      revision: plan.revision,
      rows,
      grade: null,
      schoolYear: "2026–2027",
    },
  });
  expect(saved.status()).toBe(200);
  for (const grade of [2, 10]) {
    const collection = await (
      await request.get(`/api/ktp/collection?grade=${grade}`)
    ).json();
    expect(collection.items).toHaveLength(1);
    expect(collection.items[0].grades).toEqual([2, 10]);
    expect(collection.items[0]).not.toHaveProperty("rows");
  }
  expect(
    (await (await request.get("/api/ktp/collection?grade=7")).json()).matched,
  ).toBe(0);
  await page.context().addCookies((await request.storageState()).cookies);
  await page
    .context()
    .addCookies([{ name: "ziyatai-locale", value: "ru", url: qaOrigin }]);
  await page.goto("/");
  await page.getByLabel("Фильтр по классу", { exact: true }).selectOption("10");
  await expect(page.locator(".resource-row")).toHaveCount(1);
  await expect(page.locator(".resource-row")).toContainText("2, 10");
  const next = await request.patch(`/api/ktp/${plan.id}/rows`, {
    headers,
    data: {
      revision: (await saved.json()).revision,
      rows: [rows[0]],
      grade: null,
      schoolYear: "2026–2027",
    },
  });
  expect(next.status()).toBe(200);
  expect(
    (await (await request.get("/api/ktp/collection?grade=10")).json()).matched,
  ).toBe(0);
  expect(
    (await (await request.get(`/api/ktp/${plan.id}`)).json()).rows,
  ).toHaveLength(1);
});

test("backfill uses current revision, sheet labels and fallback without guessing objective codes", async ({
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = [
      { ...plan.rows[0], grade: 2 },
      {
        ...plan.rows[0],
        grade: null,
        source: { ...plan.rows[0].source, sheet: "10А" },
      },
      {
        ...plan.rows[0],
        grade: null,
        source: { ...plan.rows[0].source, sheet: "9.1.2.1" },
      },
    ];
    await client.query(
      "UPDATE plan_versions SET rows=$2 WHERE plan_id=$1 AND revision=$3",
      [plan.id, JSON.stringify(rows), plan.revision],
    );
    await client.query("UPDATE plans SET grades=NULL,grade=7 WHERE id=$1", [
      plan.id,
    ]);
    await backfillPlanGrades(client);
    expect(
      (await client.query("SELECT grades FROM plans WHERE id=$1", [plan.id]))
        .rows[0].grades,
    ).toEqual([2, 7, 10]);
    await backfillPlanGrades(client);
    expect(
      (await client.query("SELECT grades FROM plans WHERE id=$1", [plan.id]))
        .rows[0].grades,
    ).toEqual([2, 7, 10]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
