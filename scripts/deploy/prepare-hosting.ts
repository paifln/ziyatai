import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { backendEnvironmentKeys } from "../../server/config/env";
import {
  readEnvFile,
  writeEnvFile,
  isConfigured,
  containerEnvironment,
} from "../lib/env-file.mjs";

type Values = Record<string, string>;
export function hostingFiles(
  input: {
    siteId: string;
    siteOrigin: string;
    operator: string;
    contact?: string;
    apiOrigin?: string;
    projectId?: string;
  },
  source: Values,
  previous: Values = {},
  previousFrontend: Values = {},
) {
  for (const id of [
    input.siteId,
    ...(input.projectId ? [input.projectId] : []),
  ])
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
    isConfigured(previous[key])
      ? previous[key]
      : randomBytes(32).toString("hex");
  const backend: Values = {
    ...Object.fromEntries(
      backendEnvironmentKeys.flatMap((key) => {
        const value = previous[key] ?? source[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
    APP_ENV: "production",
    API_GATEWAY: "netlify",
    DATABASE_SCHEMA:
      previous.DATABASE_SCHEMA || source.DATABASE_SCHEMA || "ziyatai",
    PASSWORD_RESET_ENABLED:
      previous.PASSWORD_RESET_ENABLED ||
      source.PASSWORD_RESET_ENABLED ||
      "false",
    STORAGE_LIFECYCLE_MODE:
      previous.STORAGE_LIFECYCLE_MODE ||
      source.STORAGE_LIFECYCLE_MODE ||
      "worker",
    RENDERER_URL: previous.RENDERER_URL || "http://renderer:8090",
    CLAMAV_HOST: previous.CLAMAV_HOST || "antivirus",
    CLAMAV_PORT: previous.CLAMAV_PORT || "3310",
    SCAN_REQUIRED: "true",
    ALLOW_DEMO: "false",
    APP_URL: siteOrigin,
    AUTH_SECRET: secret("AUTH_SECRET"),
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
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
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
    NETLIFY_SITE_ID: input.siteId,
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
        ...[
          "DATABASE_URL",
          "SUPABASE_URL",
          "SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_SECRET_KEY",
          "STORAGE_ENDPOINT",
          "STORAGE_PUBLIC_ENDPOINT",
          "STORAGE_REGION",
          "STORAGE_BUCKET",
          "STORAGE_ACCESS_KEY",
          "STORAGE_SECRET_KEY",
          "UPLOAD_ORIGIN",
        ].filter((key) => !isConfigured(backend[key])),
        ...Object.keys(frontend).filter((key) => !isConfigured(frontend[key])),
      ]),
    ].sort(),
  };
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
      target: { type: "string", default: "laptop" },
    },
  });
  const folder = ".local/hosting";
  if (!["laptop", "railway"].includes(values.target))
    throw new Error("target must be laptop or railway");
  const backendPath = `${folder}/${values.target === "laptop" ? "laptop-backend.env" : "railway-shared.env"}`;
  const frontendPath = `${folder}/${values.target === "laptop" ? "laptop-netlify.env" : "netlify.env"}`;
  execFileSync("git", ["check-ignore", backendPath], {
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
    await readEnvFile(".env.local", true),
    await readEnvFile(backendPath, true),
    await readEnvFile(frontendPath, true),
  );
  await mkdir(folder, { recursive: true });
  await writeEnvFile(backendPath, result.backend);
  await writeEnvFile(frontendPath, result.frontend);
  if (values.target === "laptop") {
    await writeEnvFile(
      `${folder}/laptop-container.env`,
      containerEnvironment(result.backend),
      "docker",
    );
    await mkdir(".local/fonts", { recursive: true });
    await writeEnvFile(".local/renderer.env", {
      RENDERER_TOKEN: result.backend.RENDERER_TOKEN,
    });
  }
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
      written: [backendPath, frontendPath, `${folder}/manifest.json`],
      unresolvedNamesOnly: result.unresolved,
      cloudChangesPerformed: false,
    }),
  );
}
