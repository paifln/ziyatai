import { describe, test, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  storage: vi.fn(),
  pool: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    query = mocks.query;
    on = vi.fn();
    constructor(options: unknown) {
      mocks.pool(options);
    }
  },
}));
vi.mock("../apps/web/lib/env", () => ({
  env: () => ({ DATABASE_URL: "fixture" }),
}));
vi.mock("../apps/web/lib/storage", () => ({ storageReady: mocks.storage }));
import { createReadinessProbe, readiness } from "../apps/web/lib/readiness";

describe("public readiness admission", () => {
  test("concurrent callers share one check and a short cached result", async () => {
    let finish!: (value: boolean) => void;
    let now = 0;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const probe = createReadinessProbe(check, () => now);
    const calls = Array.from({ length: 200 }, () => probe());
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(1);
    expect(calls.every((call) => call === calls[0])).toBe(true);
    finish(true);
    expect((await Promise.all(calls)).every(Boolean)).toBe(true);
    now = 1999;
    expect(await probe()).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    now = 2000;
    const next = probe();
    await Promise.resolve();
    finish(false);
    expect(await next).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });

  test("failures are cached too and a later successful check recovers", async () => {
    let now = 0;
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error("private dependency detail"))
      .mockResolvedValue(true);
    const probe = createReadinessProbe(check, () => now);
    expect(await probe()).toBe(false);
    expect(await probe()).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    now = 2001;
    expect(await probe()).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  test("a synchronous configuration failure is contained", async () => {
    const probe = createReadinessProbe(() => {
      throw new Error("bad configuration");
    });
    expect(await probe()).toBe(false);
  });

  test("real dependency wiring isolates DB capacity and bounds storage time", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      mocks.query.mockResolvedValue({ rowCount: 1 });
      mocks.storage.mockResolvedValue(undefined);
      expect(await readiness()).toBe(true);
      expect(mocks.pool).toHaveBeenCalledWith(
        expect.objectContaining({
          max: 1,
          connectionTimeoutMillis: 2000,
          query_timeout: 2000,
          statement_timeout: 2000,
        }),
      );
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining("worker_health"),
      );
      expect(mocks.storage.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
      now += 2001;
      mocks.query.mockResolvedValue({ rowCount: 0 });
      expect(await readiness()).toBe(false);
      now += 2001;
      mocks.query.mockResolvedValue({ rowCount: 1 });
      mocks.storage.mockRejectedValue(new Error("private storage error"));
      expect(await readiness()).toBe(false);
      now += 2001;
      mocks.storage.mockResolvedValue(undefined);
      mocks.query.mockRejectedValue(new Error("private database error"));
      expect(await readiness()).toBe(false);
      now += 2001;
      mocks.query.mockResolvedValue({ rowCount: 1 });
      expect(await readiness()).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});
