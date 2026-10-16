import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
await mkdir(".local", { recursive: true });
try {
  await access(".env.local");
  console.log("Existing local environment retained.");
} catch {
  const secret = () => randomBytes(32).toString("hex");
  const password = secret();
  const text = `DATABASE_URL=postgresql://ziyatai:${password}@127.0.0.1:55432/ziyatai
POSTGRES_PASSWORD=${password}
POSTGRES_IMAGE=ziyatai-postgres:local
POSTGRES_VOLUME_NAME=ziyatai-local_postgres
AUTH_SECRET=${secret()}
APP_URL=http://localhost:3000
STORAGE_ENDPOINT=http://127.0.0.1:53900
STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:53900
STORAGE_REGION=garage
STORAGE_BUCKET=ziyatai-private
STORAGE_ACCESS_KEY=GK${randomBytes(16).toString("hex")}
STORAGE_SECRET_KEY=${secret()}
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=ZiyatAI <noreply@ziyatai.local>
OPENAI_API_KEY=
OPENAI_MODEL=
SCAN_REQUIRED=false
ALLOW_DEMO=true
PARSER_CONTAINER_IMAGE=ziyatai-renderer:local
RENDER_CONTAINER_IMAGE=ziyatai-renderer:local
FONT_DIRECTORY=${process.platform === "win32" ? "C:/Windows/Fonts" : (process.env.ZIYATAI_FONT_DIR ?? "/usr/share/fonts/truetype/dejavu")}
PYTHON_PATH=python
`;
  await writeFile(".env.local", text, { mode: 0o600 });
  await writeFile(
    ".local/garage.toml",
    `metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${secret()}"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
`,
  );
  console.log(
    "Local secrets generated in ignored .env.local. No production credentials created.",
  );
}
