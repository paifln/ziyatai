import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const [input, output] of [
  ["apps/worker/index.ts", "dist/worker.mjs"],
  ["scripts/migrate.ts", "dist/migrate.mjs"],
  ["scripts/preflight.ts", "dist/preflight.mjs"],
])
  await build({
    entryPoints: [input],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: input === "scripts/preflight.ts" ? "bundle" : "external",
    target: "node24",
  });
