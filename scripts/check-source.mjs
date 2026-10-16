import { execFileSync } from "node:child_process";
const ignored = execFileSync(
  "git",
  [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
    "apps",
    "packages",
    "migrations",
    "infra",
    "scripts",
    ".railway",
    "tests",
    "public",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const source = ignored.filter(
  (name) =>
    !name.includes("/__pycache__/") &&
    !["public/_headers", "public/_redirects"].includes(name) &&
    (/\.(?:ts|tsx|js|mjs|py|json|sql|ya?ml|html|css|svg|png|toml|go|sh)$/.test(
      name,
    ) ||
      /(?:^|\/)(?:Dockerfile(?:\.\w+)?|go\.(?:mod|sum))$/.test(name)),
);
if (source.length)
  throw new Error(
    `Source files hidden by Git ignore rules:\n${source.join("\n")}`,
  );
console.log(
  "No application source is hidden by repository or global Git ignore rules.",
);
