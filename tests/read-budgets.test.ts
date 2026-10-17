import { it, expect } from "vitest";
import { readBucket, readBudgets } from "../apps/web/lib/read-budgets";

it("classifies full material fallback routes and expensive binary work without caller-controlled bucket keys", () => {
  for (const [path, expected] of [
    [["ktp"], "metadata"],
    [["history"], "metadata"],
    [["jobs", "id"], "metadata"],
    [["ktp", "id"], "snapshot"],
    [["ktp", "id", "source"], "metadata"],
    [["ktp", "id", "source", "unknown"], "snapshot"],
    [["ktp", "id", "unknown-action"], "snapshot"],
    [["generations", "id", "versions"], "snapshot"],
    [["drafts", "id"], "snapshot"],
    [["drafts"], "metadata"],
    [["uploads", "id"], "download"],
    [["exports", "id", "download"], "download"],
    [["ktp", "id", "preview"], "preview"],
  ] as const) {
    expect(readBucket([...path])).toBe(expected);
  }
  for (const id of ["one", "another", "random-resource-key"])
    expect(readBucket(["drafts", id])).toBe("snapshot");
  expect(readBudgets.snapshot.perMinute).toBeLessThan(
    readBudgets.metadata.perMinute,
  );
  expect(readBudgets.preview.burst).toBeLessThan(readBudgets.snapshot.burst);
});
