import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isConfigured, readEnvFile, writeEnvFile } from "../lib/env-file.mjs";

export async function prepareLocal(directory = process.cwd()) {
  const path = resolve(directory, ".env.local");
  const existing = await readEnvFile(path, true);
  const fresh = !Object.keys(existing).length;
  const values: Record<string, string> = fresh
    ? {
        ...(await readEnvFile(resolve(directory, ".env.example"))),
        APP_ENV: "local",
        APP_URL: "http://localhost:3000",
        API_GATEWAY: "direct",
      }
    : { ...existing };
  for (const key of ["AUTH_SECRET", "RENDERER_TOKEN"]) {
    if (!isConfigured(values[key]))
      values[key] = randomBytes(32).toString("hex");
  }
  if (!values.APP_ENV) values.APP_ENV = "local";
  if (values.APP_ENV === "local") {
    if (!isConfigured(values.APP_URL)) values.APP_URL = "http://localhost:3000";
    if (
      !isConfigured(values.RENDERER_URL) ||
      values.RENDERER_URL === "http://renderer:8090"
    )
      values.RENDERER_URL = "http://127.0.0.1:18090";
    if (
      !isConfigured(values.CLAMAV_HOST) ||
      ["clam-update", "antivirus"].includes(values.CLAMAV_HOST)
    ) {
      values.CLAMAV_HOST = "127.0.0.1";
      values.CLAMAV_PORT = "13310";
    }
  }
  for (const key of ["OPENAI_API_KEY", "OPENAI_MODEL"])
    if (!isConfigured(values[key])) values[key] = "";
  if (
    isConfigured(values.STORAGE_ENDPOINT) &&
    !isConfigured(values.STORAGE_PUBLIC_ENDPOINT)
  )
    values.STORAGE_PUBLIC_ENDPOINT = values.STORAGE_ENDPOINT;
  if (
    isConfigured(values.STORAGE_PUBLIC_ENDPOINT) &&
    !isConfigured(values.UPLOAD_ORIGIN)
  )
    values.UPLOAD_ORIGIN = new URL(values.STORAGE_PUBLIC_ENDPOINT).origin;
  values.SCAN_REQUIRED = "true";
  await mkdir(resolve(directory, ".local/fonts"), { recursive: true });
  await writeEnvFile(resolve(directory, ".local/renderer.env"), {
    RENDERER_TOKEN: values.RENDERER_TOKEN,
  });
  await writeEnvFile(path, values);
  return { fresh, values };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await prepareLocal();
  console.log(
    "Local configuration and renderer credentials prepared. Existing configured credentials were retained. Fill Supabase settings in .env.local before starting.",
  );
}
