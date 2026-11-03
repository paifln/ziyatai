import { expect, it } from "vitest";
import { cleanupQuarantinePage } from "../server/infrastructure/storage/upload-cleanup";

it("deletes expired quarantine replays without touching published files or recent uploads", async () => {
  const removed: string[] = [],
    now = Date.now();
  const list = async () => ({
    objects: [
      { Key: "quarantine/old-replay", LastModified: new Date(now - 86400001) },
      { Key: "quarantine/recent", LastModified: new Date(now - 300000) },
      { Key: "uploads/published", LastModified: new Date(0) },
      { Key: "quarantine/unknown-date" },
    ],
    nextCursor: "next",
  });
  const result = await cleanupQuarantinePage(
    undefined,
    list,
    async (key) => {
      removed.push(key);
    },
    now,
  );
  expect(removed).toEqual(["quarantine/old-replay"]);
  expect(result).toEqual({ removed: 1, failed: 0, nextCursor: "next" });
});
it("continues after a failed delete and preserves pagination", async () => {
  const result = await cleanupQuarantinePage(
    "cursor",
    async (cursor) => {
      expect(cursor).toBe("cursor");
      return {
        objects: [{ Key: "quarantine/old", LastModified: new Date(0) }],
        nextCursor: undefined,
      };
    },
    async () => {
      throw new Error("synthetic storage outage");
    },
  );
  expect(result.failed).toBe(1);
});

it("keeps the current page cursor when its shared cleanup budget expires", async () => {
  const abort = new AbortController();
  const removed: string[] = [];
  const result = await cleanupQuarantinePage(
    "current-page",
    async (_cursor, signal) => {
      expect(signal).toBe(abort.signal);
      return {
        objects: ["one", "two", "three"].map((name) => ({
          Key: `quarantine/${name}`,
          LastModified: new Date(0),
        })),
        nextCursor: "next-page",
      };
    },
    async (key, signal) => {
      expect(signal).toBe(abort.signal);
      removed.push(key);
      if (removed.length === 2) abort.abort();
    },
    Date.now(),
    abort.signal,
  );
  expect(removed).toEqual(["quarantine/one", "quarantine/two"]);
  expect(result).toEqual({ removed: 2, failed: 0, nextCursor: "current-page" });
});

it("stops after a timed-out delete and leaves the page available for retry", async () => {
  const result = await cleanupQuarantinePage(
    "current-page",
    async () => ({
      objects: [{ Key: "quarantine/old", LastModified: new Date(0) }],
      nextCursor: "next-page",
    }),
    async (_key, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
      }),
    Date.now(),
    AbortSignal.timeout(25),
  );
  expect(result).toEqual({ removed: 0, failed: 1, nextCursor: "current-page" });
});
