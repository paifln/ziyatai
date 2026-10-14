import { env } from "../apps/web/lib/env";
const e = env();
if (
  e.APP_ENV === "production" &&
  (!e.OPENAI_API_KEY || !e.OPENAI_MODEL || !e.CLAMAV_HOST)
)
  throw new Error("Production OpenAI or antivirus provider is not configured");
console.log("Server configuration validated.");
