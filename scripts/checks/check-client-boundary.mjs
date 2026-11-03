import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

async function clientEntries(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await clientEntries(path)));
    else if (/\.[jt]sx?$/.test(entry.name)) {
      const source = await readFile(path, "utf8");
      if (/^\s*["']use client["'];?/.test(source)) found.push(path);
    }
  }
  return found;
}

/** Follow runtime imports (including re-exports/dynamic imports), not type imports. */
export async function checkClientBoundary(entries) {
  const roots = entries ?? [
    ...(await clientEntries(resolve("app"))),
    ...(await clientEntries(resolve("apps/web"))),
  ];
  await build({
    entryPoints: roots,
    outdir: ".local/client-boundary",
    bundle: true,
    write: false,
    platform: "browser",
    packages: "external",
    logLevel: "silent",
    plugins: [
      {
        name: "private-server-boundary",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(?:node:|server-only$|pg$|@aws-sdk\/|nodemailer$|openai$)/,
            },
            (args) => ({
              errors: [
                {
                  text: `Server dependency reached a browser entry: ${args.path}`,
                },
              ],
            }),
          );
          builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
            const name = relative(process.cwd(), args.path).replaceAll(
              "\\",
              "/",
            );
            if (
              name.startsWith("server/") ||
              /\.server\.[cm]?[jt]sx?$/.test(name) ||
              name.startsWith("apps/worker/") ||
              name.startsWith("apps/renderer/")
            ) {
              return {
                errors: [
                  {
                    text: `Private server module reached a browser entry: ${name}`,
                  },
                ],
              };
            }
            // esbuild's normal loader still handles the module and its dependencies.
            return undefined;
          });
        },
      },
    ],
  });
  return roots.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const count = await checkClientBoundary();
    console.log(
      `Checked ${count} browser entry points: private server modules are isolated.`,
    );
  } catch (error) {
    // esbuild error messages contain paths, never source excerpts or env values.
    for (const issue of error.errors ?? [
      { text: "Client boundary check failed" },
    ])
      console.error(issue.text);
    process.exitCode = 1;
  }
}
