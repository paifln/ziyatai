import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

// Local CLI credentials only. Never accepts or emits hosted project keys.
const status = JSON.parse(
  await readFile(".local/supabase-status.json", "utf8"),
);
if (
  new URL(status.API_URL).hostname !== "127.0.0.1" ||
  new URL(status.DB_URL).hostname !== "127.0.0.1"
)
  throw new Error("CI requires local Supabase");
const secret = () => randomBytes(32).toString("hex");
const documents = process.argv.includes("--documents");
if (
  documents &&
  (!status.S3_PROTOCOL_ACCESS_KEY_ID ||
    !status.S3_PROTOCOL_ACCESS_KEY_SECRET ||
    !status.S3_PROTOCOL_REGION)
)
  throw new Error("Local Supabase S3 protocol credentials missing");
const values = {
  APP_ENV: "local",
  APP_URL: "http://localhost:3000",
  PASSWORD_RESET_ENABLED: "false",
  AUTH_SECRET: secret(),
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  DATABASE_URL: status.DB_URL,
  DATABASE_SCHEMA: "ziyatai",
  DATABASE_POOL_MAX: "5",
  STORAGE_ENDPOINT: `${status.API_URL}/storage/v1/s3`,
  STORAGE_REGION: documents ? status.S3_PROTOCOL_REGION : "local",
  STORAGE_BUCKET: "ziyatai-private",
  STORAGE_ACCESS_KEY: documents
    ? status.S3_PROTOCOL_ACCESS_KEY_ID
    : "ci-storage-unused",
  STORAGE_SECRET_KEY: documents
    ? status.S3_PROTOCOL_ACCESS_KEY_SECRET
    : secret(),
  STORAGE_LIFECYCLE_MODE: "worker",
  SCAN_REQUIRED: documents ? "true" : "false",
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: "13310",
  RENDERER_URL: "http://127.0.0.1:18090",
  RENDERER_TOKEN: secret(),
  DEFAULT_EXPORT_FONT: "Liberation Serif",
  ALLOW_DEMO: "false",
  API_GATEWAY: "direct",
};
if (!values.SUPABASE_PUBLISHABLE_KEY || !values.SUPABASE_SECRET_KEY)
  throw new Error("Local Supabase keys missing");
if (documents) {
  await mkdir(".local/fonts", { recursive: true });
  await writeFile(
    ".local/renderer.env",
    `RENDERER_TOKEN=${values.RENDERER_TOKEN}\n`,
    { mode: 0o600 },
  );
}
await writeFile(
  ".env.local",
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log("Isolated Supabase CI environment prepared.");
