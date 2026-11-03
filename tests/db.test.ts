import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock("../apps/web/lib/env", () => ({
  env: () => ({ DATABASE_URL: "postgres://synthetic.invalid/fixture" }),
}));
vi.mock("pg", () => ({
  Pool: class extends EventEmitter {
    constructor(options: unknown) {
      super();
      fixture.constructor(options);
    }
    connect = fixture.connect;
  },
}));
import { db, transaction } from "../apps/web/lib/db";

beforeEach(() => {
  delete (globalThis as { ziyataiPool?: unknown }).ziyataiPool;
  vi.clearAllMocks();
  fixture.connect.mockResolvedValue(
    Object.assign(new EventEmitter(), {
      query: fixture.query,
      release: fixture.release,
    }),
  );
  fixture.query.mockReset().mockResolvedValue({ rows: [] });
});
afterEach(() => vi.restoreAllMocks());

it("commits successful work and releases the connection", async () => {
  const result = await transaction(async (client) => {
    await client.query("SELECT 1");
    return "complete";
  });
  expect(result).toBe("complete");
  expect(fixture.query.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN",
    "SELECT 1",
    "COMMIT",
  ]);
  expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
});

it("rolls back failed work and preserves its original error", async () => {
  const failure = new Error("synthetic operation failure");
  await expect(
    transaction(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(fixture.query.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN",
    "ROLLBACK",
  ]);
  expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
});

it("discards a connection if rollback fails without masking the operation error", async () => {
  const failure = new Error("synthetic operation failure");
  fixture.query.mockImplementation(async (sql) => {
    if (sql === "ROLLBACK") throw new Error("synthetic connection loss");
    return { rows: [] };
  });
  await expect(
    transaction(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
});

it("never invokes work when acquiring a connection fails", async () => {
  const failure = new Error("synthetic pool exhaustion");
  fixture.connect.mockRejectedValue(failure);
  const work = vi.fn();
  await expect(transaction(work)).rejects.toBe(failure);
  expect(work).not.toHaveBeenCalled();
  expect(fixture.release).not.toHaveBeenCalled();
});

it("handles a disconnected checked-out client and never commits its work", async () => {
  const failure = new Error("synthetic connection loss between statements");
  await expect(
    transaction(async (client) => {
      client.emit("error", failure);
      return "must not commit";
    }),
  ).rejects.toBe(failure);
  expect(fixture.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
  expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
  const client = await fixture.connect.mock.results[0].value;
  expect(client.listenerCount("error")).toBe(0);
});

it("bounds pool acquisition and handles idle errors without exposing server details", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const pool = db();
  expect(db()).toBe(pool);
  expect(fixture.constructor).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      connectionTimeoutMillis: 5000,
      max: 10,
    }),
  );
  expect(() =>
    pool.emit("error", new Error("private server details")),
  ).not.toThrow();
  expect(log).toHaveBeenCalledExactlyOnceWith(
    '{"event":"database_idle_connection_failed"}',
  );
});
