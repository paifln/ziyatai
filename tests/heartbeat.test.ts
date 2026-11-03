import { afterEach, expect, it, vi } from "vitest";
import { startHeartbeat } from "../apps/worker/heartbeat";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("coalesces ticks while an earlier heartbeat is pending and stops with the job", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const stop = startHeartbeat(refresh, 100);
  await vi.advanceTimersByTimeAsync(500);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(100);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  finish();
  await vi.advanceTimersByTimeAsync(500);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("contains rejected and synchronously thrown heartbeats and tries again on the next tick", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("private database details"))
    .mockImplementationOnce(() => {
      throw new Error("private transport details");
    })
    .mockResolvedValue(undefined);
  const stop = startHeartbeat(refresh, 100);
  await vi.advanceTimersByTimeAsync(300);
  stop();
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(log).toHaveBeenCalledTimes(2);
  for (const args of log.mock.calls)
    expect(args).toEqual(['{"event":"worker_heartbeat_failed"}']);
});
