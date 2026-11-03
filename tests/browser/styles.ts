import { build } from "esbuild";
const compiled = new Map<string, Promise<string>>();
/** Resolve generated CSS imports before injecting styles into an isolated fixture. */
export function browserStyles(path: string) {
  if (!compiled.has(path))
    compiled.set(
      path,
      build({
        entryPoints: [path],
        bundle: true,
        write: false,
        external: ["/fonts/*", "/assets/*"],
        loader: { ".woff2": "dataurl", ".woff": "dataurl" },
        logLevel: "silent",
      }).then((result) => result.outputFiles[0].text),
    );
  return compiled.get(path)!;
}
