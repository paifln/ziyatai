import { expect, it } from "vitest";
import { cleanupQuarantinePage } from "../apps/web/lib/upload-cleanup";

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
