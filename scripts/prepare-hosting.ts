import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

type Values = Record<string, string>;
export function hostingFiles(
  input: {
    siteId: string;
    siteOrigin: string;
    operator: string;
    contact?: string;
    apiOrigin?: string;
    projectId: string;
  },
  source: Values,
  previous: Values = {},
  previousFrontend: Values = {},
) {
  for (const id of [input.siteId, input.projectId])
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new Error("Valid linked project and site UUIDs are required");
  const origin = (value: string) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Hosting URLs must be HTTPS origins");
    return url.origin;
  };
  const siteOrigin = origin(input.siteOrigin);
  if (input.apiOrigin) origin(input.apiOrigin);
  if (
    previous.NETLIFY_PROXY_SECRET &&
    previousFrontend.NETLIFY_PROXY_SECRET &&
    previous.NETLIFY_PROXY_SECRET !== previousFrontend.NETLIFY_PROXY_SECRET
  )
    throw new Error(
      "Existing proxy secrets disagree; reconcile privately before preparation",
    );
  const secret = (key: string) =>
    previous[key] || randomBytes(32).toString("hex");
  const backend: Values = {
    ...previous,
    APP_URL: siteOrigin,
    AUTH_SECRET: secret("AUTH_SECRET"),
    POSTGRES_PASSWORD: secret("POSTGRES_PASSWORD"),
    RENDERER_TOKEN: secret("RENDERER_TOKEN"),
    NETLIFY_SITE_ID: input.siteId,
    NETLIFY_PROXY_SECRET:
      previous.NETLIFY_PROXY_SECRET ||
      previousFrontend.NETLIFY_PROXY_SECRET ||
      randomBytes(32).toString("hex"),
    OPENAI_API_KEY: previous.OPENAI_API_KEY || source.OPENAI_API_KEY || "",
    LEGAL_OPERATOR_NAME: input.operator,
    LEGAL_CONTACT_EMAIL: input.contact || previous.LEGAL_CONTACT_EMAIL || "",
  };
  for (const key of [
    "STORAGE_ENDPOINT",
    "STORAGE_PUBLIC_ENDPOINT",
    "STORAGE_REGION",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "UPLOAD_ORIGIN",
  ])
    backend[key] ??= "";
  backend.STORAGE_FORCE_PATH_STYLE ??= "false";
  const frontend: Values = {
    ZIYATAI_API_ORIGIN:
      input.apiOrigin || previousFrontend.ZIYATAI_API_ORIGIN || "",
    UPLOAD_ORIGIN: backend.UPLOAD_ORIGIN,
    NETLIFY_PROXY_SECRET: backend.NETLIFY_PROXY_SECRET,
    LEGAL_OPERATOR_NAME: input.operator,
    LEGAL_CONTACT_EMAIL: backend.LEGAL_CONTACT_EMAIL,
  };
  return {
    backend,
    frontend,
    unresolved: [
      ...new Set([
        ...Object.keys(backend).filter((key) => !backend[key]),
        ...Object.keys(frontend).filter((key) => !frontend[key]),
      ]),
    ].sort(),
  };
}
function serialize(values: Values) {
  const result =
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n";
  const decoded = parseEnv(result);
  for (const [key, value] of Object.entries(values))
    if (decoded[key] !== value || /[\r\n\0]/.test(value))
      throw new Error(`Cannot safely serialize ${key}`);
  return result;
}
async function readValues(path: string) {
  try {
    return Object.fromEntries(
      Object.entries(parseEnv(await readFile(path, "utf8"))).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  } catch (error: any) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      "site-id": { type: "string" },
      "site-origin": { type: "string" },
      "project-id": { type: "string" },
      operator: { type: "string" },
      contact: { type: "string" },
      "api-origin": { type: "string" },
    },
  });
  const folder = ".local/hosting";
  execFileSync("git", ["check-ignore", `${folder}/railway-shared.env`], {
    stdio: "ignore",
  });
  const input = {
    siteId: values["site-id"] || "",
    siteOrigin: values["site-origin"] || "",
    projectId: values["project-id"] || "",
    operator: values.operator || "",
    contact: values.contact,
    apiOrigin: values["api-origin"],
  };
  if (!input.operator.trim()) throw new Error("An operator name is required");
  const result = hostingFiles(
    input,
    await readValues(".env.local"),
    await readValues(`${folder}/railway-shared.env`),
    await readValues(`${folder}/netlify.env`),
  );
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/railway-shared.env`, serialize(result.backend), {
    mode: 0o600,
  });
  await writeFile(`${folder}/netlify.env`, serialize(result.frontend), {
    mode: 0o600,
  });
  await writeFile(
    `${folder}/manifest.json`,
    JSON.stringify(
      {
        projectId: input.projectId,
        siteId: input.siteId,
        siteOrigin: input.siteOrigin,
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        unresolved: result.unresolved,
        cloudChangesPerformed: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      written: ["railway-shared.env", "netlify.env", "manifest.json"],
      unresolvedNamesOnly: result.unresolved,
      cloudChangesPerformed: false,
    }),
  );
}
