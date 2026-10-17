import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type Values = Record<string, string | undefined>;
export type DeploymentProfile = "backend" | "frontend";
export type DeploymentCheck = {
  id: string;
  status: "pass" | "blocked" | "manual";
  message: string;
};

// Reports contain only fixed messages and identifiers, never supplied values.
const supplied = (value: string | undefined) =>
  Boolean(value?.trim() && !/YOUR_|REPLACE_|CHANGE_ME|^\s*$/i.test(value));
function origin(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return supplied(value) &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !/^(localhost|127\.|\[?::1\]?)/i.test(url.hostname)
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export async function deploymentChecks(
  values: Values,
  profile: DeploymentProfile,
) {
  const checks: DeploymentCheck[] = [];
  const check = (id: string, ok: boolean, message: string) =>
    checks.push({ id, status: ok ? "pass" : "blocked", message });
  const secret = (name: string, min = 1) =>
    supplied(values[name]) && values[name]!.length >= min;
  const manual = (id: string, message: string) =>
    checks.push({ id, status: "manual", message });
  check(
    "upload-origin",
    Boolean(origin(values.UPLOAD_ORIGIN)),
    "UPLOAD_ORIGIN: публичный HTTPS origin хранилища без пути и credentials.",
  );
  check(
    "site-id",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      values.NETLIFY_SITE_ID ?? "",
    ),
    "NETLIFY_SITE_ID: UUID production-сайта.",
  );
  check(
    "proxy-secret",
    secret("NETLIFY_PROXY_SECRET", 32),
    "NETLIFY_PROXY_SECRET: отдельный случайный секрет от 32 символов.",
  );
  check(
    "legal-contact",
    supplied(values.LEGAL_OPERATOR_NAME) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.LEGAL_CONTACT_EMAIL ?? "") &&
      supplied(values.LEGAL_CONTACT_EMAIL),
    "LEGAL_OPERATOR_NAME и LEGAL_CONTACT_EMAIL: данные оператора для правовых страниц.",
  );
  if (profile === "frontend") {
    check(
      "api-origin",
      Boolean(origin(values.ZIYATAI_API_ORIGIN)),
      "ZIYATAI_API_ORIGIN: публичный HTTPS origin Railway API.",
    );
    check(
      "frontend-secrets",
      [
        "DATABASE_URL",
        "AUTH_SECRET",
        "STORAGE_ACCESS_KEY",
        "STORAGE_SECRET_KEY",
        "SMTP_PASSWORD",
        "GOOGLE_CLIENT_SECRET",
        "APPLE_CLIENT_SECRET",
        "OPENAI_API_KEY",
        "RENDERER_TOKEN",
      ].every((name) => !values[name]),
      "В Netlify не должны передаваться серверные DB/S3/SMTP/OpenAI/renderer секреты.",
    );
    manual(
      "netlify-scopes",
      "В Netlify: proxy secret в Runtime, site ID и публичные origins доступны сборке. После смены origins нужна пересборка.",
    );
  } else {
    check("production", values.APP_ENV === "production", "APP_ENV=production.");
    check(
      "app-origin",
      Boolean(origin(values.APP_URL)),
      "APP_URL: точный публичный HTTPS origin Netlify.",
    );
    check(
      "gateway",
      values.API_GATEWAY === "netlify" && values.DIRECT_UPLOADS === "true",
      "API_GATEWAY=netlify и DIRECT_UPLOADS=true.",
    );
    check(
      "auth-secret",
      secret("AUTH_SECRET", 32) &&
        values.AUTH_SECRET !== values.NETLIFY_PROXY_SECRET,
      "AUTH_SECRET: от 32 символов, отличается от proxy secret.",
    );
    let database = false;
    try {
      const url = new URL(values.DATABASE_URL ?? "");
      database =
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        Boolean(
          url.hostname &&
          url.username &&
          url.password &&
          url.pathname.length > 1,
        ) &&
        supplied(values.DATABASE_URL);
    } catch {
      /* Invalid URLs must not escape into reports. */
    }
    check(
      "database",
      database,
      "DATABASE_URL: подключение PostgreSQL с БД и credentials.",
    );
    check(
      "scanning",
      values.SCAN_REQUIRED === "true" &&
        values.ALLOW_DEMO === "false" &&
        supplied(values.CLAMAV_HOST),
      "Обязательный ClamAV, SCAN_REQUIRED=true, ALLOW_DEMO=false.",
    );
    let renderer = false;
    try {
      const url = new URL(values.RENDERER_URL ?? "");
      renderer =
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash;
    } catch {
      /* Do not print private URLs. */
    }
    check(
      "renderer",
      renderer &&
        secret("RENDERER_TOKEN", 32) &&
        !values.PARSER_CONTAINER_IMAGE &&
        !values.RENDER_CONTAINER_IMAGE,
      "Приватный HTTP renderer с отдельным токеном, без вложенного Docker.",
    );
    check(
      "ai",
      secret("OPENAI_API_KEY") && supplied(values.OPENAI_MODEL),
      "OPENAI_API_KEY и проверенный OPENAI_MODEL настроены на backend.",
    );
    check(
      "smtp",
      (values.EMAIL_VERIFICATION_REQUIRED === "false" && !values.SMTP_HOST) ||
        (supplied(values.SMTP_HOST) &&
          [465, 587].includes(Number(values.SMTP_PORT ?? 587)) &&
          supplied(values.SMTP_FROM) &&
          /@/.test(values.SMTP_FROM ?? "")),
      "Внешний SMTP с TLS: порт 465/587 и адрес отправителя.",
    );
    check(
      "smtp-auth",
      (values.EMAIL_VERIFICATION_REQUIRED === "false" && !values.SMTP_HOST) ||
        (secret("SMTP_USER") && secret("SMTP_PASSWORD")),
      "Аутентификация внешнего SMTP задана.",
    );
    const storage =
      supplied(values.STORAGE_BUCKET) &&
      supplied(values.STORAGE_REGION) &&
      secret("STORAGE_ACCESS_KEY") &&
      secret("STORAGE_SECRET_KEY") &&
      Boolean(origin(values.STORAGE_ENDPOINT)) &&
      (!values.STORAGE_PUBLIC_ENDPOINT ||
        Boolean(origin(values.STORAGE_PUBLIC_ENDPOINT))) &&
      ["true", "false"].includes(values.STORAGE_FORCE_PATH_STYLE ?? "true");
    check(
      "storage",
      storage,
      "Приватное S3: HTTPS endpoint, bucket, region, credentials и корректный path-style режим.",
    );
    let matches = false;
    if (storage) {
      const client = new S3Client({
        endpoint: values.STORAGE_PUBLIC_ENDPOINT || values.STORAGE_ENDPOINT,
        region: values.STORAGE_REGION,
        forcePathStyle: values.STORAGE_FORCE_PATH_STYLE !== "false",
        requestChecksumCalculation: "WHEN_REQUIRED",
        // Signing is entirely offline and uses synthetic credentials.
        credentials: {
          accessKeyId: "deployment-check",
          secretAccessKey: "offline-check-only",
        },
      });
      try {
        const signed = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: values.STORAGE_BUCKET,
            Key: "quarantine/deployment-check",
            ContentLength: 1,
            ContentType: "application/octet-stream",
          }),
          { expiresIn: 60 },
        );
        matches = new URL(signed).origin === origin(values.UPLOAD_ORIGIN);
      } catch {
        /* SDK/provider details and signed URLs stay private. */
      } finally {
        client.destroy();
      }
    }
    check(
      "upload-csp",
      matches,
      "UPLOAD_ORIGIN совпадает с origin реальной S3-подписи; учитывается bucket subdomain.",
    );
    check(
      "ai-budgets",
      [
        "DAILY_AI_LIMIT",
        "GLOBAL_DAILY_AI_LIMIT",
        "DAILY_AI_TOKEN_LIMIT",
        "GLOBAL_DAILY_AI_TOKEN_LIMIT",
        "MAX_AI_TOKENS",
      ].every(
        (name) =>
          !values[name] ||
          (Number.isSafeInteger(Number(values[name])) &&
            Number(values[name]) > 0),
      ),
      "Лимиты AI: положительные целые числа; пустые используют defaults.",
    );
    manual(
      "private-network",
      "В Railway: БД, renderer и ClamAV без публичных domain/TCP proxy; настроить volumes и сетевую изоляцию.",
    );
    manual(
      "storage-policy",
      "Проверить точный CORS и отказ unsigned GET. Настроить lifecycle quarantine/ за сутки, если он доступен; для Railway buckets проверить worker cleanup старого quarantine, включая объекты без строки БД. При остановленном worker удаление откладывается.",
    );
    manual(
      "fonts",
      "Проверить настоящий DOCX/PDF с DEFAULT_EXPORT_FONT: свободные Liberation/Carlito входят в renderer; TNR/Arial/Calibri требуют отдельно установленных лицензированных шрифтов.",
    );
    manual(
      "real-mail-ai",
      values.EMAIL_VERIFICATION_REQUIRED === "false" && !values.SMTP_HOST
        ? "Проверить регистрацию и повторный вход без кода; восстановление почтой должно быть скрыто. Проверить генерацию AI, одобрение и сброс одобрения после правки."
        : "Проверить доставку кода и reset в реальный ящик, генерацию AI, одобрение и сброс одобрения после правки.",
    );
    manual(
      "backups",
      "Настроить backup БД и файлов; проверить восстановление и согласованные владельцем условия хранения данных.",
    );
  }
  manual(
    "live-acceptance",
    "Это проверка конфигурации без сети. Сопоставить настройки обоих сервисов, проверить /api/health/ready на публичном домене и пройти staging-приёмку.",
  );
  return checks;
}
