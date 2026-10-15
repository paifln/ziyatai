import { readFile, writeFile } from "node:fs/promises";
let text = await readFile(".env.local", "utf8");
text = text.replace("SCAN_REQUIRED=false", "SCAN_REQUIRED=true");
if (!text.includes("CLAMAV_HOST="))
  text += "\nCLAMAV_HOST=127.0.0.1\nCLAMAV_PORT=13310\n";
if (!text.includes("APP_ENV=")) text += "APP_ENV=local\n";
await writeFile(".env.local", text, { mode: 0o600 });
const publicEndpoint =
  text.match(/^STORAGE_PUBLIC_ENDPOINT=(.+)$/m)?.[1] ||
  text.match(/^STORAGE_ENDPOINT=(.+)$/m)?.[1];
if (!/^STORAGE_PUBLIC_ENDPOINT=/m.test(text))
  text += `\nSTORAGE_PUBLIC_ENDPOINT=${publicEndpoint}\n`;
await writeFile(".env.local", text, { mode: 0o600 });
// Rewrite internal connection hosts only. The browser origin and secret values
// must stay exactly as supplied by the operator.
const container = text
  .replace(
    /^(DATABASE_URL|STORAGE_ENDPOINT|SMTP_HOST|CLAMAV_HOST|RENDERER_URL)=(.*)$/gm,
    (line, key: string, value: string) => {
      if (["SMTP_HOST", "CLAMAV_HOST"].includes(key))
        return ["127.0.0.1", "localhost"].includes(value.trim())
          ? `${key}=host.docker.internal`
          : line;
      try {
        const url = new URL(value.trim());
        if (["127.0.0.1", "localhost"].includes(url.hostname)) {
          url.hostname = "host.docker.internal";
          return `${key}=${url.toString()}`;
        }
      } catch {
        /* Preserve unrecognized values for validation by the server. */
      }
      return line;
    },
  )
  .replace(
    /^STORAGE_PUBLIC_ENDPOINT=.*$/m,
    `STORAGE_PUBLIC_ENDPOINT=${publicEndpoint}`,
  );
await writeFile(".local/docker.env", container, { mode: 0o600 });
console.log("Local container environment prepared without exposing secrets.");
