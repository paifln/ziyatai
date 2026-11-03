import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readEnvFile,
  writeEnvFile,
  containerEnvironment,
} from "../lib/env-file.mjs";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const action = process.argv[2] || "status";
const railwayPublication = action === "publish-railway";
const folder = ".local/hosting";
const backendFile = `${folder}/laptop-backend.env`;
const frontendFile = `${folder}/${railwayPublication ? "railway" : "laptop"}-netlify.env`;
const publishedFile = `${folder}/${railwayPublication ? "railway" : "laptop"}-published.json`;
const image =
  "cloudflare/cloudflared@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba";
const tunnels = ["ziyatai-laptop-api-tunnel"];
const compose = [
  "compose",
  "--env-file",
  ".env.local",
  "-f",
  "infra/compose.laptop.yml",
];
function docker(args, capture = false) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}
async function readEnv(file) {
  return readEnvFile(file);
}
async function siteOrigin() {
  const value = JSON.parse(
    await readFile(`${folder}/manifest.json`, "utf8"),
  ).siteOrigin;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Manifest requires an HTTPS site origin");
  return url.origin;
}
async function saveEnv(file, values, raw = false) {
  return writeEnvFile(file, values, raw ? "docker" : "dotenv");
}
const pause = (ms) =>
  new Promise((resolvePause) => setTimeout(resolvePause, ms));
async function tunnel(name, port) {
  const existing = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Running}}", name],
    { encoding: "utf8" },
  );
  if (existing.status !== 0)
    docker([
      "run",
      "-d",
      "--name",
      name,
      image,
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      `http://host.docker.internal:${port}`,
    ]);
  else if (existing.stdout.trim() !== "true") docker(["start", name]);
  const startedAt = docker(
    ["inspect", "--format", "{{.State.StartedAt}}", name],
    true,
  ).trim();
  for (let attempt = 0; attempt < 45; attempt++) {
    const logs = spawnSync("docker", ["logs", "--since", startedAt, name], {
      encoding: "utf8",
    });
    const addresses = [
      ...(logs.stdout + logs.stderr).matchAll(
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
      ),
    ];
    if (addresses.length) return addresses.at(-1)[0];
    await pause(1000);
  }
  throw new Error(`Tunnel ${name} did not provide an HTTPS address`);
}
async function waitReady(origin) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health/ready`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
    } catch {
      /* Docker and the tunnel may still be starting. */
    }
    await pause(1000);
  }
  throw new Error(
    "Backend did not become ready; inspect Docker logs before inviting participants.",
  );
}
async function publish(frontend) {
  const allowed = new Set([
    "NETLIFY_SITE_ID",
    "NETLIFY_PROXY_SECRET",
    "ZIYATAI_API_ORIGIN",
    "UPLOAD_ORIGIN",
    "LEGAL_OPERATOR_NAME",
    "LEGAL_CONTACT_EMAIL",
  ]);
  if (Object.keys(frontend).some((key) => !allowed.has(key)))
    throw new Error(
      "Frontend configuration contains unsupported variables; remove backend credentials before publishing",
    );
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error("Commit the reviewed source before publishing");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid release commit");
  const config = JSON.parse(
    await readFile(
      join(
        process.env.APPDATA || join(homedir(), "AppData/Roaming"),
        "netlify/Config/config.json",
      ),
      "utf8",
    ),
  );
  const token = config.users[config.userId]?.auth?.token;
  if (!token) throw new Error("Sign in to Netlify CLI before publishing");
  const siteId = frontend.NETLIFY_SITE_ID;
  async function api(route, options = {}) {
    const response = await fetch(`https://api.netlify.com/api/v1${route}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Netlify API returned ${response.status}`);
    return response.json();
  }
  const site = await api(`/sites/${siteId}`);
  const envRoute = `/accounts/${site.account_slug}/env`;
  const existing = await api(`${envRoute}?site_id=${siteId}`);
  for (const [key, value] of Object.entries(frontend)) {
    const previous = existing.find((item) => item.key === key);
    const item = {
      key,
      scopes: previous?.scopes || [
        "builds",
        "functions",
        "runtime",
        "post_processing",
      ],
      values: [
        ...(previous?.values || [])
          .filter((entry) => entry.context !== "production")
          .map(({ context, context_parameter, value: stored }) => ({
            context,
            context_parameter,
            value: stored,
          })),
        { context: "production", value },
      ],
    };
    if (previous)
      await api(`${envRoute}/${encodeURIComponent(key)}?site_id=${siteId}`, {
        method: "PUT",
        body: JSON.stringify(item),
      });
    else
      await api(`${envRoute}?site_id=${siteId}`, {
        method: "POST",
        body: JSON.stringify([item]),
      });
  }
  await saveEnv(
    `${folder}/netlify-cli.env`,
    { NETLIFY_AUTH_TOKEN: token, NETLIFY_SITE_ID: siteId },
    true,
  );
  const buildDirectory = `/releases/${commit}`;
  const snapshot = `${folder}/release-source.tar`;
  execFileSync("git", [
    "archive",
    "--format=tar",
    `--output=${snapshot}`,
    "HEAD",
  ]);
  const builder = spawnSync("docker", ["inspect", "ziyatai-netlify-build"], {
    stdio: "ignore",
  });
  if (builder.status === 0) docker(["start", "ziyatai-netlify-build"]);
  else
    docker([
      "run",
      "-d",
      "--name",
      "ziyatai-netlify-build",
      "--entrypoint",
      "sleep",
      "node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5",
      "infinity",
    ]);
  docker(["cp", snapshot, "ziyatai-netlify-build:/tmp/ziyatai-release.tar"]);
  docker(["exec", "ziyatai-netlify-build", "mkdir", "-p", buildDirectory]);
  docker([
    "exec",
    "ziyatai-netlify-build",
    "tar",
    "-xf",
    "/tmp/ziyatai-release.tar",
    "-C",
    buildDirectory,
  ]);
  docker(["exec", "-w", buildDirectory, "ziyatai-netlify-build", "npm", "ci"]);
  // Build on the container filesystem: the adapter renames .next while packaging.
  // Mounting .next as a separate volume would fail with EBUSY/EXDEV.
  const buildEnv = [
    "ZIYATAI_API_ORIGIN",
    "UPLOAD_ORIGIN",
    "LEGAL_OPERATOR_NAME",
    "LEGAL_CONTACT_EMAIL",
  ].flatMap((key) => ["-e", `${key}=${frontend[key] || ""}`]);
  // Keep onPreBuild's signed redirect in the same in-memory config as deployment.
  // A separate `deploy --no-build` reads the original TOML and loses that rule.
  docker([
    "exec",
    "--env-file",
    `${folder}/netlify-cli.env`,
    "-w",
    buildDirectory,
    ...buildEnv,
    "ziyatai-netlify-build",
    "npx",
    "--yes",
    "netlify-cli@27.12.1",
    "deploy",
    "--prod",
    "--build",
  ]);
  await writeFile(
    publishedFile,
    JSON.stringify(
      {
        api: frontend.ZIYATAI_API_ORIGIN,
        storage: frontend.UPLOAD_ORIGIN,
        commit,
        publishedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}
try {
  if (!["start", "stop", "status", "publish", "publish-railway", "build"].includes(action))
    throw new Error(
      "Usage: node scripts/deploy/laptop-backend.mjs start|stop|status|publish|build",
    );
  if (action === "build") {
    const frontend = await readEnv(frontendFile);
    const args = [
      "UPLOAD_ORIGIN",
      "LEGAL_OPERATOR_NAME",
      "LEGAL_CONTACT_EMAIL",
    ].flatMap((key) => ["--build-arg", `${key}=${frontend[key] || ""}`]);
    docker([
      "build",
      "-f",
      "infra/Dockerfile",
      "--target",
      "web",
      "-t",
      "ziyatai-web:laptop",
      ...args,
      ".",
    ]);
    docker([
      "build",
      "-f",
      "infra/Dockerfile",
      "--target",
      "worker",
      "-t",
      "ziyatai-worker:laptop",
      ".",
    ]);
    docker([
      "build",
      "-f",
      "infra/Dockerfile.renderer",
      "-t",
      "ziyatai-renderer:laptop",
      ".",
    ]);
    console.log("Laptop images built. Run start to recreate services.");
  } else if (action === "status") {
    docker([
      "ps",
      "-a",
      "--filter",
      "name=ziyatai-",
      "--format",
      "{{.Names}}: {{.Status}}",
    ]);
    const frontend = await readEnv(frontendFile);
    const site = await siteOrigin();
    const response = await fetch(`${site}/api/health/ready`, {
      signal: AbortSignal.timeout(15000),
    });
    console.log(
      `Public readiness: ${response.status}; backend: ${frontend.ZIYATAI_API_ORIGIN}`,
    );
    if (!response.ok) throw new Error("Public backend is unavailable");
  } else if (action === "stop") {
    const { Pool } = await import("pg");
    const local = await readEnv(backendFile);
    if (!/^[a-z_][a-z0-9_]*$/.test(local.DATABASE_SCHEMA || ""))
      throw new Error("A valid backend DATABASE_SCHEMA is required");
    const { databaseConnection } =
      await import("../../apps/web/lib/database-connection.ts");
    const pool = new Pool({
      ...databaseConnection(local),
      options: `-c search_path=${local.DATABASE_SCHEMA},public`,
      connectionTimeoutMillis: 5000,
    });
    try {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS count FROM jobs WHERE status IN ('queued','running')",
      );
      if (rows[0].count)
        throw new Error(
          "Jobs are pending. Wait for them to finish before stopping the backend.",
        );
    } finally {
      await pool.end();
    }
    docker([...compose, "stop"]);
    docker(["stop", ...tunnels]);
    console.log("Backend stopped. Database and files remain in Supabase.");
  } else {
    const frontend = await readEnv(frontendFile);
    if (action === "start") {
      docker(["info", "--format", "{{.ServerVersion}}"]);
      const backend = await readEnv(backendFile);
      frontend.ZIYATAI_API_ORIGIN = await tunnel(tunnels[0], 3001);
      frontend.UPLOAD_ORIGIN = new URL(
        backend.STORAGE_PUBLIC_ENDPOINT || backend.STORAGE_ENDPOINT,
      ).origin;
      backend.UPLOAD_ORIGIN = frontend.UPLOAD_ORIGIN;
      await saveEnv(backendFile, backend);
      await writeEnvFile(
        `${folder}/laptop-container.env`,
        containerEnvironment(backend),
        "docker",
      );
      await saveEnv(frontendFile, frontend);
      docker([...compose, "up", "-d"]);
      let previous;
      try {
        previous = JSON.parse(await readFile(publishedFile, "utf8"));
      } catch {
        /* First publication. */
      }
      if (
        previous?.api !== frontend.ZIYATAI_API_ORIGIN ||
        previous?.storage !== frontend.UPLOAD_ORIGIN
      ) {
        console.log(
          "Tunnel addresses changed. Rebuilding and publishing Netlify with the new addresses (uses Netlify deploy credits).",
        );
        await publish(frontend);
      }
    } else await publish(frontend);
    const site = await siteOrigin();
    await waitReady(site);
    const configuration = await fetch(`${site}/api/public-config`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!configuration.ok) throw new Error("Netlify API proxy is unavailable");
    console.log(railwayPublication
      ? `Open ${site}. Backend runs on Railway; the laptop is not required.`
      : `Open ${site} and keep this laptop and Docker running.`);
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Laptop backend action failed",
  );
  process.exitCode = 1;
}
