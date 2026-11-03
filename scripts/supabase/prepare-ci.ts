import { readFile, writeFile } from "node:fs/promises";
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
const values = {
  APP_ENV: "local",
  APP_URL: "http://localhost:3000",
  AUTH_PROVIDER: "supabase",
  AUTH_SECRET: secret(),
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  DATABASE_URL: status.DB_URL,
  DATABASE_SCHEMA: "ziyatai",
  DATABASE_POOL_MAX: "5",
  STORAGE_ENDPOINT: `${status.API_URL}/storage/v1/s3`,
  STORAGE_REGION: "local",
  STORAGE_BUCKET: "ziyatai-private",
  STORAGE_ACCESS_KEY: "ci-storage-unused",
  STORAGE_SECRET_KEY: secret(),
  STORAGE_LIFECYCLE_MODE: "worker",
  SCAN_REQUIRED: "false",
  ALLOW_DEMO: "false",
  API_GATEWAY: "direct",
};
if (!values.SUPABASE_PUBLISHABLE_KEY || !values.SUPABASE_SECRET_KEY)
  throw new Error("Local Supabase keys missing");
await writeFile(
  ".env.local",
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log("Isolated Supabase CI environment prepared.");
