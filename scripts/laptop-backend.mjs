import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const action = process.argv[2] || "status";
const folder = ".local/hosting";
const backendFile = `${folder}/laptop-backend.env`;
const frontendFile = `${folder}/laptop-netlify.env`;
const publishedFile = `${folder}/laptop-published.json`;
const image = "cloudflare/cloudflared@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba";
const dependencies = ["ziyatai-local-postgres-1", "ziyatai-local-storage-1", "ziyatai-tools-antivirus-1"];
const tunnels = ["ziyatai-laptop-api-tunnel", "ziyatai-laptop-storage-tunnel"];
const compose = ["compose", "--env-file", ".env.local", "-f", "infra/compose.laptop.yml"];
function docker(args, capture = false) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
}
async function readEnv(file) { return parseEnv(await readFile(file, "utf8")); }
async function saveEnv(file, values, raw = false) {
  if (Object.values(values).some(value => /[\r\n]/.test(value))) throw new Error("Multiline environment values are unsupported");
  await writeFile(file, Object.entries(values).map(([key, value]) => `${key}=${raw ? value : JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
}
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
async function tunnel(name, port) {
  const existing = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", name], { encoding: "utf8" });
  if (existing.status !== 0) docker(["run", "-d", "--name", name, image, "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://host.docker.internal:${port}`]);
  else if (existing.stdout.trim() !== "true") docker(["start", name]);
  const startedAt = docker(["inspect", "--format", "{{.State.StartedAt}}", name], true).trim();
  for (let attempt = 0; attempt < 45; attempt++) {
    const logs = spawnSync("docker", ["logs", "--since", startedAt, name], { encoding: "utf8" });
    const addresses = [...(logs.stdout + logs.stderr).matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)];
    if (addresses.length) return addresses.at(-1)[0];
    await pause(1000);
  }
  throw new Error(`Tunnel ${name} did not provide an HTTPS address`);
}
async function waitReady(origin) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health/ready`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch { /* Docker and the tunnel may still be starting. */ }
    await pause(1000);
  }
  throw new Error("Backend did not become ready; inspect Docker logs before inviting participants.");
}
async function publish(frontend) {
  const config = JSON.parse(await readFile(join(process.env.APPDATA || join(homedir(), "AppData/Roaming"), "netlify/Config/config.json"), "utf8"));
  const token = config.users[config.userId]?.auth?.token;
  if (!token) throw new Error("Sign in to Netlify CLI before publishing");
  const siteId = frontend.NETLIFY_SITE_ID;
  async function api(route, options = {}) {
    const response = await fetch(`https://api.netlify.com/api/v1${route}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Netlify API returned ${response.status}`);
    return response.json();
  }
  const site = await api(`/sites/${siteId}`);
  const envRoute = `/accounts/${site.account_slug}/env`;
  const existing = await api(`${envRoute}?site_id=${siteId}`);
  for (const [key, value] of Object.entries(frontend)) {
    const previous = existing.find(item => item.key === key);
    const item = { key, scopes: previous?.scopes || ["builds", "functions", "runtime", "post_processing"], values: [...(previous?.values || []).filter(entry => entry.context !== "production").map(({ context, context_parameter, value: stored }) => ({ context, context_parameter, value: stored })), { context: "production", value }] };
    if (previous) await api(`${envRoute}/${encodeURIComponent(key)}?site_id=${siteId}`, { method: "PUT", body: JSON.stringify(item) });
    else await api(`${envRoute}?site_id=${siteId}`, { method: "POST", body: JSON.stringify([item]) });
  }
  await saveEnv(`${folder}/netlify-cli.env`, { NETLIFY_AUTH_TOKEN: token, NETLIFY_SITE_ID: siteId }, true);
  docker(["start", "ziyatai-netlify-build"]);
  // Build on the container filesystem: the adapter renames .next while packaging.
  // Mounting .next as a separate volume would fail with EBUSY/EXDEV.
  const buildEnv = ["ZIYATAI_API_ORIGIN", "UPLOAD_ORIGIN", "LEGAL_OPERATOR_NAME", "LEGAL_CONTACT_EMAIL"].flatMap(key => ["-e", `${key}=${frontend[key] || ""}`]);
  // Keep onPreBuild's signed redirect in the same in-memory config as deployment.
  // A separate `deploy --no-build` reads the original TOML and loses that rule.
  docker(["exec", "--env-file", `${folder}/netlify-cli.env`, "-w", "/build", ...buildEnv, "ziyatai-netlify-build", "npx", "--yes", "netlify-cli@27.12.1", "deploy", "--prod", "--build"]);
  await writeFile(publishedFile, JSON.stringify({ api: frontend.ZIYATAI_API_ORIGIN, storage: frontend.UPLOAD_ORIGIN, publishedAt: new Date().toISOString() }, null, 2) + "\n");
}
try {
  if (!["start", "stop", "status", "publish"].includes(action)) throw new Error("Usage: node scripts/laptop-backend.mjs start|stop|status|publish");
  if (action === "status") {
    docker(["ps", "-a", "--filter", "name=ziyatai-", "--format", "{{.Names}}: {{.Status}}"]);
    const frontend = await readEnv(frontendFile);
    const site = JSON.parse(await readFile(".local/hosting/manifest.json", "utf8")).siteOrigin;
    const response = await fetch(`${site}/api/health/ready`, { signal: AbortSignal.timeout(15000) });
    console.log(`Public readiness: ${response.status}; backend: ${frontend.ZIYATAI_API_ORIGIN}`);
    if (!response.ok) throw new Error("Public backend is unavailable");
  } else if (action === "stop") {
    const { Pool } = await import("pg");
    const local = await readEnv(".env.local");
    const pool = new Pool({ connectionString: local.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      const { rows } = await pool.query("SELECT count(*)::int AS count FROM jobs WHERE status IN ('queued','running')");
      if (rows[0].count) throw new Error("Jobs are pending. Wait for them to finish before stopping the backend.");
    } finally { await pool.end(); }
    docker([...compose, "stop"]);
    docker(["stop", ...tunnels, ...dependencies]);
    console.log("Backend stopped. Database and files remain on their existing volumes.");
  } else {
    const frontend = await readEnv(frontendFile);
    if (action === "start") {
      docker(["info", "--format", "{{.ServerVersion}}"]);
      docker(["start", ...dependencies]);
      const backend = await readEnv(backendFile);
      frontend.ZIYATAI_API_ORIGIN = await tunnel(tunnels[0], 3001);
      frontend.UPLOAD_ORIGIN = await tunnel(tunnels[1], 53900);
      backend.STORAGE_PUBLIC_ENDPOINT = frontend.UPLOAD_ORIGIN;
      backend.UPLOAD_ORIGIN = frontend.UPLOAD_ORIGIN;
      await saveEnv(backendFile, backend);
      await saveEnv(frontendFile, frontend, true);
      const local = await readEnv(".env.local");
      await saveEnv(`${folder}/laptop-host.env`, { ...backend, DATABASE_URL: local.DATABASE_URL, STORAGE_ENDPOINT: "http://127.0.0.1:53900", RENDERER_URL: "http://127.0.0.1:18091" });
      const oldWorker = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", "ziyatai-runtime-worker-1"], { encoding: "utf8" });
      if (oldWorker.status === 0 && oldWorker.stdout.trim() === "true") console.log("A separate local worker is running and shares this queue. Avoid simultaneous local testing during public sessions.");
      execFileSync(process.execPath, [`--env-file=${folder}/laptop-host.env`, "--import", "tsx", "scripts/configure-storage.ts"], { stdio: "inherit" });
      docker([...compose, "up", "-d"]);
      let previous;
      try { previous = JSON.parse(await readFile(publishedFile, "utf8")); } catch { /* First publication. */ }
      if (previous?.api !== frontend.ZIYATAI_API_ORIGIN || previous?.storage !== frontend.UPLOAD_ORIGIN) {
        console.log("Tunnel addresses changed. Rebuilding and publishing Netlify with the new addresses (uses Netlify deploy credits).");
        await publish(frontend);
      }
    } else await publish(frontend);
    await waitReady("https://ziyatai.netlify.app");
    const configuration = await fetch("https://ziyatai.netlify.app/api/public-config", { signal: AbortSignal.timeout(15000) });
    if (!configuration.ok) throw new Error("Netlify API proxy is unavailable");
    console.log("Open https://ziyatai.netlify.app and keep this laptop and Docker running.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Laptop backend action failed");
  process.exitCode = 1;
}
