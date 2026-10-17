import { z } from "zod";
const schema = z.object({
  APP_ENV: z
    .enum(["local", "staging", "production"])
    .default(process.env.NODE_ENV === "production" ? "production" : "local"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  API_GATEWAY: z.enum(["direct", "netlify"]).default("direct"),
  NETLIFY_PROXY_SECRET: z.string().default(""),
  NETLIFY_SITE_ID: z.string().default(""),
  APP_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    }, "APP_URL must be an origin")
    .transform((value) => new URL(value).origin),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_PUBLIC_ENDPOINT: z.string().default(""),
  STORAGE_REGION: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  STORAGE_LIFECYCLE_MODE: z.enum(["provider", "worker"]).default("provider"),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  EMAIL_VERIFICATION_REQUIRED: z.enum(["true", "false"]).default("true"),
  GOOGLE_CLIENT_ID: z.string().trim().default(""),
  GOOGLE_CLIENT_SECRET: z.string().trim().default(""),
  APPLE_CLIENT_ID: z.string().trim().default(""),
  APPLE_CLIENT_SECRET: z.string().trim().default(""),
  DEFAULT_EXPORT_FONT: z
    .enum([
      "Times New Roman",
      "Arial",
      "Calibri",
      "Liberation Serif",
      "Liberation Sans",
      "Carlito",
    ])
    .default("Times New Roman"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_FROM: z.string().default(""),
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
      parsed.EMAIL_VERIFICATION_REQUIRED === "true" &&
      (!parsed.SMTP_HOST || !parsed.SMTP_FROM)
    )
      throw new Error("Email verification requires a configured mail sender");
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
    if (
      parsed.APP_ENV === "production" &&
      (!parsed.APP_URL.startsWith("https://") ||
        (parsed.DIRECT_UPLOADS === "true" &&
          !(
            parsed.STORAGE_PUBLIC_ENDPOINT || parsed.STORAGE_ENDPOINT
          ).startsWith("https://")))
    )
      throw new Error(
        "Production requires HTTPS application and direct-upload origins",
      );
    if (
      parsed.APP_ENV === "production" &&
      [
        parsed.DATABASE_URL,
        parsed.AUTH_SECRET,
        parsed.RENDERER_TOKEN,
        parsed.STORAGE_ACCESS_KEY,
        parsed.STORAGE_SECRET_KEY,
        parsed.OPENAI_API_KEY,
        parsed.SMTP_PASSWORD,
      ].some((value) => /YOUR_|REPLACE_|CHANGE_ME/i.test(value))
    )
      throw new Error(
        "Production credentials still contain example placeholders",
      );
    if (
      parsed.API_GATEWAY === "netlify" &&
      (parsed.NETLIFY_PROXY_SECRET.length < 32 ||
        !z.uuid().safeParse(parsed.NETLIFY_SITE_ID).success ||
        /YOUR_|REPLACE_|CHANGE_ME/i.test(parsed.NETLIFY_PROXY_SECRET))
    )
      throw new Error(
        "Netlify gateway requires a separate random proxy secret and valid site ID",
      );
    if (
      parsed.API_GATEWAY === "netlify" &&
      parsed.NETLIFY_PROXY_SECRET === parsed.AUTH_SECRET
    )
      throw new Error(
        "Netlify proxy secret must differ from authentication secret",
      );
    if (
      parsed.API_GATEWAY === "netlify" &&
      parsed.APP_ENV === "production" &&
      parsed.DIRECT_UPLOADS !== "true"
    )
      throw new Error(
        "Netlify gateway requires direct S3 uploads in production",
      );
    cache = parsed;
  }
  return cache;
}
