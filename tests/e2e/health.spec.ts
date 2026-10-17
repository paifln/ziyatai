import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";

test("public readiness bursts stay healthy with one isolated DB connection", async ({
  request,
}) => {
  const responses = await Promise.all(
    Array.from({ length: 100 }, () => request.get("/api/health/ready")),
  );
  for (const response of responses) {
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const settings = parseEnv(await readFile(".env.local", "utf8"));
  const pool = new Pool({ connectionString: settings.DATABASE_URL });
  try {
    const active = await pool.query(
      "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name='ziyatai-readiness'",
    );
    expect(active.rows[0].count).toBe(1);
  } finally {
    await pool.end();
  }
  const head = await request.head("/api/health/ready");
  expect(head.status()).toBe(200);
  expect(await head.body()).toHaveLength(0);
});

test("health routes reject mutations and unknown paths while liveness stays lightweight", async ({
  request,
}) => {
  for (const path of ["health", "health/live", "health/ready"]) {
    const response = await request.post(`/api/${path}`);
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe("GET, HEAD");
  }
  for (const path of ["health/unknown", "health/ready/extra", "health/x/ready"])
    expect((await request.get(`/api/${path}`)).status()).toBe(404);
  expect(await (await request.get("/api/health/live")).json()).toEqual({
    status: "ok",
  });
  expect(await (await request.get("/api/health")).json()).toEqual({
    status: "ok",
  });
});
