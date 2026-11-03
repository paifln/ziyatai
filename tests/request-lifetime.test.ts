import { expect, it } from "vitest";
import {
  createRequestLifetime,
  withinRequestLifetime,
} from "../apps/web/lib/request-lifetime";

it("cancels all old owner's work while preserving independent caller cancellation", async () => {
  const first = createRequestLifetime();
  const next = createRequestLifetime();
  const caller = new AbortController();
  let combined!: AbortSignal;
  const pending = withinRequestLifetime(
    caller.signal,
    first.signal,
    async (signal) => {
      combined = signal!;
      return new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  );
  first.stop();
  await pending;
  expect(combined.aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
  expect(next.signal.aborted).toBe(false);
});

it("preserves a caller's early abort and releases the combined lifetime after completion", async () => {
  const owner = createRequestLifetime();
  const caller = new AbortController();
  caller.abort();
  expect(
    await withinRequestLifetime(
      caller.signal,
      owner.signal,
      async (signal) => signal!.aborted,
    ),
  ).toBe(true);
  const other = new AbortController();
  let completed!: AbortSignal;
  await withinRequestLifetime(other.signal, owner.signal, async (signal) => {
    completed = signal!;
  });
  owner.stop();
  expect(completed.aborted).toBe(false);
});

it("reactivates a Strict Mode effect replay without reviving already captured requests", () => {
  const lifetime = createRequestLifetime();
  const first = lifetime.signal;
  lifetime.stop();
  lifetime.activate();
  expect(first.aborted).toBe(true);
  expect(lifetime.signal.aborted).toBe(false);
  expect(lifetime.signal).not.toBe(first);
});
