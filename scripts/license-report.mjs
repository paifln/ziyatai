import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
if (!process.env.npm_execpath) throw new Error("Run npm run licenses:generate");
const paths = execFileSync(
  process.execPath,
  [process.env.npm_execpath, "ls", "--omit=dev", "--parseable", "--all"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .slice(1);
const entries = [];
for (const path of paths) {
  const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  const files = (await readdir(path)).filter((f) =>
    /^(license|licence|copying|notice)([._-].*)?$/i.test(f),
  );
  let notice = "";
  for (const file of files) {
    try {
      notice += `\n${file}\n${await readFile(join(path, file), "utf8")}\n`;
    } catch {
      /* A similarly named directory is not a notice file. */
    }
  }
  entries.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license || "See package notices",
    notice,
  });
}
entries.sort((a, b) => a.name.localeCompare(b.name));
const heading =
  "ZiyatAI — third-party production dependency notices\nGenerated from the installed dependency tree. Project source licensing is determined by its owner.\nNode, Python, operating-system and font notices remain in their respective distributions.\n";
await writeFile(
  "public/licenses.txt",
  heading +
    entries
      .map(
        (p) =>
          `\n${"=".repeat(72)}\n${p.name} ${p.version}\nLicense: ${p.license}\n${p.notice || `Upstream package: https://www.npmjs.com/package/${p.name}/v/${p.version}\n`}`,
      )
      .join(""),
);
await writeFile(
  "docs/reports/node-licenses.json",
  JSON.stringify(
    {
      scope:
        "Installed production npm dependency metadata; includes transitive dependencies",
      packages: entries.map(({ name, version, license }) => ({
        name,
        version,
        license,
      })),
    },
    null,
    2,
  ),
);
console.log(
  `Notices prepared for ${entries.length} installed production packages.`,
);
