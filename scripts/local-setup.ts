import { readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await access(".env.local");
  console.log("Existing local environment retained.");
} catch {
  const template = (await readFile(".env.example", "utf8"))
    .replace("APP_ENV=production", "APP_ENV=local")
    .replace("APP_URL=https://YOUR_HOST", "APP_URL=http://localhost:3000")
    .replace(
      "AUTH_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS",
      `AUTH_SECRET=${randomBytes(32).toString("hex")}`,
    );
  await writeFile(".env.local", template, { mode: 0o600 });
  console.log(
    "Created ignored .env.local. Fill Supabase settings from .env.supabase.example before starting. No hosted resources changed.",
  );
}
