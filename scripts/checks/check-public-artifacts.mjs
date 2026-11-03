import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** Only report variable names/paths; credentials must never enter diagnostics. */
export async function checkPublicArtifacts(directories, environment) {
  const credentials = Object.entries(environment).filter(
    ([name, value]) =>
      !name.startsWith("NEXT_PUBLIC_") &&
      /(?:SECRET|PASSWORD|TOKEN|(?:^|_)KEY$|DATABASE_URL$)/i.test(name) &&
      typeof value === "string" &&
      value.length >= 16,
  );
  const issues = [];
  let files = 0;
  async function inspect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await inspect(path);
      else if (/\.(?:js|mjs|cjs|html|css|json|map|txt)$/.test(item.name)) {
        files++;
        const content = await readFile(path, "utf8");
        for (const [name, value] of credentials) {
          // JSON-encoded and URI-encoded forms can also expose a credential.
          const variants = [
            value,
            JSON.stringify(value).slice(1, -1),
            encodeURIComponent(value),
          ];
          if (variants.some((candidate) => content.includes(candidate)))
            issues.push({
              path: relative(process.cwd(), path),
              variable: name,
            });
        }
      }
    }
  }
  for (const directory of directories) await inspect(directory);
  return { files, credentialCount: credentials.length, issues };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await checkPublicArtifacts(
    [".next/static", "public"],
    process.env,
  );
  if (report.issues.length) {
    for (const issue of report.issues)
      console.error(
        `Credential ${issue.variable} detected in public artifact ${JSON.stringify(issue.path)}`,
      );
    process.exitCode = 1;
  } else
    console.log(
      `Checked ${report.files} public artifacts against ${report.credentialCount} configured credential values; no matches.`,
    );
}
