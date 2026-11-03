import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import { assertUploadStorageQuota } from "../apps/web/lib/storage-quota";

function usage(bytes: string, count: number) {
  const query = vi.fn(async () => ({ rows: [{ bytes, count }] }));
  return { query, connection: { query } as unknown as PoolClient };
}

it("admits the exact byte limit and refuses one extra byte", async () => {
  const limit = 500 * 1024 * 1024;
  await expect(
    assertUploadStorageQuota(
      usage(String(limit - 1), 1).connection,
      "teacher",
      1,
    ),
  ).resolves.toBeUndefined();
  await expect(
    assertUploadStorageQuota(usage(String(limit), 1).connection, "teacher", 1),
  ).rejects.toMatchObject({ code: "LIMIT", status: 429 });
});

it("refuses the file-count limit independently of byte usage", async () => {
  await expect(
    assertUploadStorageQuota(usage("100", 100).connection, "teacher", 1),
  ).rejects.toMatchObject({ code: "LIMIT", status: 429 });
});

it.each([-1, 0, NaN, Infinity, 0.5])(
  "rejects invalid incoming byte count %s before querying storage usage",
  async (bytes) => {
    const database = usage("0", 0);
    await expect(
      assertUploadStorageQuota(database.connection, "teacher", bytes),
    ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
    expect(database.query).not.toHaveBeenCalled();
  },
);
