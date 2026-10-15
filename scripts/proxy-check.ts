import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const docker = async (...args: string[]) =>
  (
    await exec("docker", args, { windowsHide: true, maxBuffer: 1024 * 1024 })
  ).stdout.trim();
const prefix = `ziyatai-proxy-check-${randomBytes(5).toString("hex")}`;
const webImage = process.env.WEB_TEST_IMAGE || "ziyatai-web:local";
const proxyImage = process.env.PROXY_TEST_IMAGE || "ziyatai-proxy:local";
const upstream = prefix + "-web",
  proxy = prefix + "-edge";
try {
  await docker("network", "create", prefix);
  await docker(
    "run",
    "-d",
    "--name",
    upstream,
    "--network",
    prefix,
    "--network-alias",
    "web",
    "--read-only",
    "--cap-drop",
    "ALL",
    webImage,
    "node",
    "-e",
    "require('http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,forwardedProto:req.headers['x-forwarded-proto']}));}).listen(3000,'0.0.0.0')",
  );
  await docker(
    "run",
    "-d",
    "--name",
    proxy,
    "--network",
    prefix,
    "-p",
    "127.0.0.1::8080",
    "-e",
    "APP_HOST=http://:8080",
    "-e",
    "APP_URL=https://frontend.example.test",
    "--read-only",
    "--tmpfs",
    "/config:size=16m",
    "--tmpfs",
    "/data:size=16m",
    "--cap-drop",
    "ALL",
    "-v",
    `${resolve("infra/Caddyfile.hybrid")}:/etc/caddy/Caddyfile:ro`,
    proxyImage,
  );
  const ports = JSON.parse(
    await docker(
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      proxy,
    ),
  );
  const base = `http://127.0.0.1:${ports["8080/tcp"][0].HostPort}`;
  let response: Response | undefined;
  for (let i = 0; i < 30; i++) {
    try {
      response = await fetch(base + "/api/health?check=1");
      if (response.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(response?.ok, "Proxy did not become ready");
  assert.equal((await response.json()).path, "/api/health?check=1");
  const redirect = await fetch(base + "/lite/?generation=synthetic", {
    redirect: "manual",
  });
  assert.equal(redirect.status, 302);
  assert.equal(
    redirect.headers.get("location"),
    "https://frontend.example.test/lite/?generation=synthetic",
  );
  for (const file of ["Caddyfile", "Caddyfile.hybrid"])
    await docker(
      "run",
      "--rm",
      "-e",
      "APP_HOST=http://:8080",
      "-e",
      "APP_URL=https://frontend.example.test",
      "-v",
      `${resolve("infra/" + file)}:/etc/caddy/Caddyfile:ro`,
      proxyImage,
      "caddy",
      "validate",
      "--config",
      "/etc/caddy/Caddyfile",
    );
  const report = {
    date: new Date().toISOString().slice(0, 10),
    image: proxyImage,
    apiPathAndQueryPreserved: true,
    frontendRedirectPreservesQuery: true,
    bothConfigurationsValid: true,
    scope:
      "Local HTTP containers and synthetic upstream; public TLS/DNS and Netlify proxy remain unverified",
  };
  await writeFile("docs/reports/proxy.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const container of [proxy, upstream])
    await docker("rm", "-f", container).catch(() => {});
  await docker("network", "rm", prefix).catch(() => {});
}
