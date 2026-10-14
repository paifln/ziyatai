import { readFile, writeFile } from "node:fs/promises";
let text = await readFile(".env.local", "utf8");
text = text.replace("SCAN_REQUIRED=false", "SCAN_REQUIRED=true");
if (!text.includes("CLAMAV_HOST="))
  text += "\nCLAMAV_HOST=127.0.0.1\nCLAMAV_PORT=13310\n";
if (!text.includes("APP_ENV=")) text += "APP_ENV=local\n";
await writeFile(".env.local", text, { mode: 0o600 });
const container = text.replaceAll("127.0.0.1", "host.docker.internal");
await writeFile(".local/docker.env", container, { mode: 0o600 });
console.log("Local container environment prepared without exposing secrets.");
