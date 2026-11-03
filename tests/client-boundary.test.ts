import { expect, it } from "vitest";
import { checkClientBoundary } from "../scripts/checks/check-client-boundary.mjs";
import { build } from "esbuild";

it("builds the worker without depending on the web application", async () => {
  const result = await build({
    entryPoints: ["apps/worker/index.ts"],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  expect(
    Object.keys(result.metafile.inputs).filter((file) =>
      file.replaceAll("\\", "/").startsWith("apps/web/"),
    ),
  ).toEqual([]);
});

it("keeps runtime server dependencies out of every browser entry point", async () => {
  expect(await checkClientBoundary()).toBeGreaterThan(20);
});

it("rejects credentials, database and worker code even behind transitive imports", async () => {
  for (const entry of [
    "server/config/env.ts",
    "server/infrastructure/storage/storage-quota.ts",
    "server/http/api.ts",
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
