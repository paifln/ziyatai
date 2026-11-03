import { expect, it } from "vitest";
import { checkClientBoundary } from "../scripts/check-client-boundary.mjs";

it("keeps runtime server dependencies out of every browser entry point", async () => {
  expect(await checkClientBoundary()).toBeGreaterThan(20);
});

it("rejects credentials, database and worker code even behind transitive imports", async () => {
  for (const entry of [
    "apps/web/lib/env.ts",
    "apps/web/lib/storage-quota.ts",
    "apps/web/lib/api.ts",
    "apps/worker/index.ts",
  ])
    await expect(checkClientBoundary([entry])).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("Private server module"),
        }),
      ]),
    });
});
