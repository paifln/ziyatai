import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const [input, output] of [
  ["apps/worker/index.ts", "dist/worker.mjs"],
  ["scripts/runtime/migrate.ts", "dist/migrate.mjs"],
  ["scripts/runtime/preflight.ts", "dist/preflight.mjs"],
])
  await build({
    entryPoints: [input],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "bundle",
    external: ["pg-native"],
    banner: {js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'},
    target: "node24",
  });
