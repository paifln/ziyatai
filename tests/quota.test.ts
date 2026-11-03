import type { PoolClient } from "pg";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  settings: {
    MAX_AI_TOKENS: 16000,
    DAILY_AI_LIMIT: 20,
    GLOBAL_DAILY_AI_LIMIT: 200,
    DAILY_AI_TOKEN_LIMIT: 200000,
    GLOBAL_DAILY_AI_TOKEN_LIMIT: 2000000,
  },
}));
vi.mock("../apps/web/lib/env", () => ({ env: () => fixture.settings }));
import { reserveQuota } from "../apps/web/lib/queue";

function client(personal = "0", global = "0") {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT count"))
      return { rows: [{ personal: 0, global: 0, concurrent: 0 }] };
    if (sql.startsWith("SELECT coalesce"))
      return { rows: [{ personal, global }] };
    return { rows: [], rowCount: 1 };
  });
  return { connection: { query } as unknown as PoolClient, query };
}

beforeEach(() => {
  fixture.settings.MAX_AI_TOKENS = 16000;
  fixture.settings.DAILY_AI_TOKEN_LIMIT = 200000;
  fixture.settings.GLOBAL_DAILY_AI_TOKEN_LIMIT = 2000000;
});

it("reserves source and replacement size using UTF-8 bytes across all three attempts", async () => {
  const { connection, query } = client();
  const input = {
    snapshot: { goals: "Қазақ тілі" },
    replace: { text: "Ә".repeat(1000) },
  };
  await reserveQuota(connection, "owner", "job", input);
  const call = query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT INTO usage_ledger"),
  );
  expect(call).toBeDefined();
  const values = (call as unknown as [string, unknown[]])[1];
  expect(values[4]).toBe(
    (16000 + 10000 + Buffer.byteLength(JSON.stringify(input), "utf8")) * 3,
  );
});

it("rejects a large edited task before recording a reservation", async () => {
  const { connection, query } = client();
  await expect(
    reserveQuota(connection, "owner", "job", { text: "x".repeat(100000) }),
  ).rejects.toMatchObject({ code: "LIMIT", status: 429 });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.startsWith("INSERT INTO usage_ledger"),
    ),
  ).toBe(false);
});

it("compares PostgreSQL bigint totals without rounding away an exceeded limit", async () => {
  fixture.settings.DAILY_AI_TOKEN_LIMIT = Number.MAX_SAFE_INTEGER;
  fixture.settings.GLOBAL_DAILY_AI_TOKEN_LIMIT = Number.MAX_SAFE_INTEGER;
  const { connection } = client(
    String(BigInt(Number.MAX_SAFE_INTEGER) - 77999n),
  );
  await expect(reserveQuota(connection, "owner", "job")).rejects.toMatchObject({
    code: "LIMIT",
    status: 429,
  });
});

it("rejects reservations outside the ledger integer range before acquiring a database lock", async () => {
  fixture.settings.MAX_AI_TOKENS = 2147483647;
  const { connection, query } = client();
  await expect(reserveQuota(connection, "owner", "job")).rejects.toMatchObject({
    code: "LIMIT",
    status: 429,
  });
  expect(query).not.toHaveBeenCalled();
});
