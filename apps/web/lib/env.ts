import { z } from "zod";
const schema = z.object({
  APP_ENV: z
    .enum(["local", "staging", "production"])
    .default(process.env.NODE_ENV === "production" ? "production" : "local"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().refine((value) => { const url=new URL(value); return !url.username && !url.password && url.pathname==="/" && !url.search && !url.hash; },"APP_URL must be an origin").transform((value)=>new URL(value).origin),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_PUBLIC_ENDPOINT: z.string().default(""),
  STORAGE_REGION: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_FROM: z.string().min(1),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default(""),
  PYTHON_PATH: z.string().default("python"),
  SOFFICE_PATH: z.string().default("soffice"),
  TESSERACT_PATH: z.string().default("tesseract"),
  CLAMSCAN_PATH: z.string().default("clamscan"),
  CLAMAV_HOST: z.string().default(""),
  CLAMAV_PORT: z.coerce.number().default(3310),
  SCAN_REQUIRED: z.enum(["true", "false"]).default("true"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(25),
  DIRECT_UPLOADS: z.enum(["true", "false"]).default("false"),
  DAILY_AI_LIMIT: z.coerce.number().default(20),
  GLOBAL_DAILY_AI_LIMIT: z.coerce.number().default(200),
  DAILY_AI_TOKEN_LIMIT: z.coerce.number().default(200000),
  GLOBAL_DAILY_AI_TOKEN_LIMIT: z.coerce.number().default(2000000),
  MAX_AI_TOKENS: z.coerce.number().default(16000),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(60).max(3600).default(180),
  ALLOW_DEMO: z.enum(["true", "false"]).default("false"),
  RENDERER_URL: z.string().default(""),
  RENDERER_TOKEN: z.string().default(""),
});
let cache:
  | (z.infer<typeof schema> & {
      PARSER_CONTAINER_IMAGE: string;
      RENDER_CONTAINER_IMAGE: string;
      FONT_DIRECTORY: string;
    })
  | undefined;
export function env() {
  if (!cache) {
    const parsed = {
      ...schema.parse(process.env),
      PARSER_CONTAINER_IMAGE: process.env.PARSER_CONTAINER_IMAGE ?? "",
      RENDER_CONTAINER_IMAGE: process.env.RENDER_CONTAINER_IMAGE ?? "",
      FONT_DIRECTORY: process.env.FONT_DIRECTORY ?? "",
    };
    if (
      parsed.APP_ENV === "production" &&
      (parsed.SCAN_REQUIRED !== "true" ||
        parsed.ALLOW_DEMO === "true" ||
        !parsed.RENDERER_URL ||
        parsed.RENDERER_TOKEN.length < 32)
    )
      throw new Error(
        "Production requires scanning, isolated renderer credentials and disables synthetic demo",
      );
    if (parsed.APP_ENV === "production" && (!parsed.APP_URL.startsWith("https://") || (parsed.DIRECT_UPLOADS === "true" && !(parsed.STORAGE_PUBLIC_ENDPOINT || parsed.STORAGE_ENDPOINT).startsWith("https://"))))
      throw new Error("Production requires HTTPS application and direct-upload origins");
    if (parsed.APP_ENV === "production" && [parsed.DATABASE_URL,parsed.AUTH_SECRET,parsed.RENDERER_TOKEN,parsed.STORAGE_ACCESS_KEY,parsed.STORAGE_SECRET_KEY,parsed.OPENAI_API_KEY,parsed.SMTP_PASSWORD].some((value)=>/YOUR_|REPLACE_|CHANGE_ME/i.test(value)))
      throw new Error("Production credentials still contain example placeholders");
    cache=parsed;
  }
  return cache;
}
