import {
  defineRailway,
  github,
  image,
  project,
  service,
  volume,
} from "railway/iac";

// Desired infrastructure only. Evaluating this file creates no cloud resources.
// Secrets are references to Railway Shared Variables, never literal values.
export default defineRailway((ctx) => {
  const source = github("paifln/ziyatai", {
    branch: "main",
    checkSuites: true,
  });
  const postgresData = volume("postgres-data", { sizeMB: 1024 });
  const antivirusData = volume("antivirus-data", { sizeMB: 1024 });
  const privateNetworking = {
    serviceDomains: {},
    customDomains: {},
    tcpProxies: {},
  };
  const continuous = {
    sleepApplication: false,
    numReplicas: 1,
    restartPolicyType: "ON_FAILURE" as const,
    restartPolicyMaxRetries: 10,
  };
  const postgres = service("postgres", {
    source,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "infra/Dockerfile.postgres",
    },
    deploy: continuous,
    networking: privateNetworking,
    volumeMounts: { "/var/lib/postgresql": postgresData },
    env: {
      POSTGRES_USER: "ziyatai",
      POSTGRES_DB: "ziyatai",
      POSTGRES_PASSWORD: ctx.shared.POSTGRES_PASSWORD,
      // Use a random hexadecimal password: references are not URI-escaped.
      DATABASE_URL:
        "postgresql://ziyatai:${{shared.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/ziyatai",
    },
  });
  const renderer = service("renderer", {
    source,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "infra/Dockerfile.renderer",
    },
    deploy: { ...continuous, sleepApplication: true },
    networking: privateNetworking,
    healthcheck: "/health",
    healthcheckTimeout: 60,
    env: {
      PORT: "8090",
      RENDERER_HOST: "::",
      RENDERER_TOKEN: ctx.shared.RENDERER_TOKEN,
    },
  });
  const antivirus = service("antivirus", {
    // Same pinned image as compose.production.yml; update both after scanning.
    source: image(
      "clamav/clamav:1.4@sha256:b5b910ce43d595bf8a2fe401e34db56434602b2c755b7c2b07f00c917d04d469",
    ),
    deploy: { ...continuous, sleepApplication: true },
    networking: privateNetworking,
    volumeMounts: { "/var/lib/clamav": antivirusData },
  });
  const common = {
    APP_ENV: "production",
    APP_URL: ctx.shared.APP_URL,
    DATABASE_URL: postgres.env.DATABASE_URL,
    AUTH_SECRET: ctx.shared.AUTH_SECRET,
    API_GATEWAY: "netlify",
    DIRECT_UPLOADS: "true",
    NETLIFY_SITE_ID: ctx.shared.NETLIFY_SITE_ID,
    NETLIFY_PROXY_SECRET: ctx.shared.NETLIFY_PROXY_SECRET,
    SCAN_REQUIRED: "true",
    ALLOW_DEMO: "false",
    EMAIL_VERIFICATION_REQUIRED: "false",
    DEFAULT_EXPORT_FONT: "Liberation Serif",
    DAILY_AI_LIMIT: "5",
    GLOBAL_DAILY_AI_LIMIT: "20",
    CLAMAV_HOST: antivirus.env.RAILWAY_PRIVATE_DOMAIN,
    CLAMAV_PORT: "3310",
    RENDERER_URL: "http://${{renderer.RAILWAY_PRIVATE_DOMAIN}}:8090",
    RENDERER_TOKEN: renderer.env.RENDERER_TOKEN,
    STORAGE_ENDPOINT: ctx.shared.STORAGE_ENDPOINT,
    STORAGE_PUBLIC_ENDPOINT: ctx.shared.STORAGE_PUBLIC_ENDPOINT,
    STORAGE_REGION: ctx.shared.STORAGE_REGION,
    STORAGE_FORCE_PATH_STYLE: ctx.shared.STORAGE_FORCE_PATH_STYLE,
    STORAGE_LIFECYCLE_MODE: "worker",
    STORAGE_BUCKET: ctx.shared.STORAGE_BUCKET,
    STORAGE_ACCESS_KEY: ctx.shared.STORAGE_ACCESS_KEY,
    STORAGE_SECRET_KEY: ctx.shared.STORAGE_SECRET_KEY,
    UPLOAD_ORIGIN: ctx.shared.UPLOAD_ORIGIN,
    OPENAI_API_KEY: ctx.shared.OPENAI_API_KEY,
    OPENAI_MODEL: "gpt-5.4-mini",
    LEGAL_OPERATOR_NAME: ctx.shared.LEGAL_OPERATOR_NAME,
    LEGAL_CONTACT_EMAIL: ctx.shared.LEGAL_CONTACT_EMAIL,
  };
  const api = service("api", {
    source,
    build: { builder: "DOCKERFILE", dockerfilePath: "infra/Dockerfile" },
    deploy: { ...continuous, sleepApplication: true },
    preDeploy: "node migrate.mjs",
    healthcheck: "/api/health/live",
    healthcheckTimeout: 60,
    cdn: { enabled: false },
    env: {
      ...common,
      ZIYATAI_TARGET: "web",
      PORT: "3000",
      HOSTNAME: "::",
      GOOGLE_CLIENT_ID: ctx.shared.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: ctx.shared.GOOGLE_CLIENT_SECRET,
      APPLE_CLIENT_ID: ctx.shared.APPLE_CLIENT_ID,
      APPLE_CLIENT_SECRET: ctx.shared.APPLE_CLIENT_SECRET,
    },
  });
  const worker = service("worker", {
    source,
    build: { builder: "DOCKERFILE", dockerfilePath: "infra/Dockerfile" },
    deploy: continuous,
    networking: privateNetworking,
    env: { ...common, ZIYATAI_TARGET: "worker" },
  });
  return project("ziyatai", {
    resources: [
      postgresData,
      antivirusData,
      postgres,
      renderer,
      antivirus,
      api,
      worker,
    ],
  });
});
