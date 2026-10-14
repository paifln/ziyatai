import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const path = ".env.local";
let contents = await readFile(path, "utf8");
const existing = contents.match(/^RENDERER_TOKEN=(.+)$/m)?.[1];
const token = existing ?? randomBytes(32).toString("hex");
if (!existing)
  contents += `\nRENDERER_URL=http://127.0.0.1:18090\nRENDERER_TOKEN=${token}\n`;
await writeFile(path, contents, { mode: 0o600 });
await writeFile(".local/renderer.env", `RENDERER_TOKEN=${token}\n`, {
  mode: 0o600,
});
console.log(
  "Isolated local renderer configured; secrets retained only in ignored files.",
);
