import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { verifiedUser } from "../tests/e2e/helpers";
const exec = promisify(execFile),
  name = "ziyatai-gateway-check-" + randomBytes(5).toString("hex");
const envFile = `.local/${name}.env`,
  secret = randomBytes(32).toString("hex"),
  siteId = randomUUID();
const image = process.env.WEB_TEST_IMAGE || "ziyatai-web:local";
const docker = async (...args: string[]) =>
  (
    await exec("docker", args, { windowsHide: true, maxBuffer: 1024 * 1024 })
  ).stdout.trim();
const token = (key = secret) => {
  const a = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const b = Buffer.from(
    JSON.stringify({
      iss: "netlify",
      netlify_id: siteId,
      exp: Math.floor(Date.now() / 1000) + 600,
      deploy_context: "production",
    }),
  ).toString("base64url");
  return (
    a +
    "." +
    b +
    "." +
    createHmac("sha256", key)
      .update(a + "." + b)
      .digest("base64url")
  );
};
const contexts: Awaited<ReturnType<typeof request.newContext>>[] = [];
try {
  const current = await readFile(".local/docker.env", "utf8");
  assert.match(
    current,
    /^APP_ENV=local\s*$/m,
    "Use the local container environment for this check",
  );
  assert.match(
    current,
    /^SMTP_HOST=(?:host\.docker\.internal|127\.0\.0\.1|localhost)\s*$/m,
    "Use local Mailpit for synthetic gateway accounts",
  );
  assert.match(
    current,
    /^SMTP_PORT=1025\s*$/m,
    "Use local Mailpit for synthetic gateway accounts",
  );
  const clean = current.replace(
    /^(?:API_GATEWAY|NETLIFY_PROXY_SECRET|NETLIFY_SITE_ID)=.*\r?\n/gm,
    "",
  );
  await writeFile(
    envFile,
    clean +
      `\nAPI_GATEWAY=netlify\nNETLIFY_PROXY_SECRET=${secret}\nNETLIFY_SITE_ID=${siteId}\n`,
    { mode: 0o600 },
  );
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "--env-file",
    envFile,
    "-e",
    "HOSTNAME=0.0.0.0",
    "-p",
    "127.0.0.1::3000",
    "--read-only",
    "--tmpfs",
    "/tmp:size=128m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    "1g",
    image,
  );
  const ports = JSON.parse(
    await docker(
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      name,
    ),
  );
  const base = `http://127.0.0.1:${ports["3000/tcp"][0].HostPort}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (i === 49) throw new Error("Gateway web did not become ready");
    await new Promise((r) => setTimeout(r, 300));
  }
  const unsigned = await request.newContext({ baseURL: base });
  contexts.push(unsigned);
  assert.equal((await unsigned.get("/api/profile")).status(), 403);
  assert.equal((await unsigned.get("/api/auth/get-session")).status(), 403);
  const createContext = async (ip: string, signature = token()) => {
    const context = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: {
        Origin: "http://localhost:3000",
        "x-nf-sign": signature,
        "x-nf-client-connection-ip": ip,
        "x-ziyatai-client-ip": "203.0.113.99",
      },
    });
    contexts.push(context);
    return context;
  };
  const forged = await createContext("192.0.2.42", token("wrong-test-key"));
  assert.equal((await forged.get("/api/auth/get-session")).status(), 403);
  const malformedIp = await createContext("192.0.2.42, 192.0.2.43");
  assert.equal((await malformedIp.get("/api/auth/get-session")).status(), 403);
  const first = await createContext("192.0.2.42");
  const user = await verifiedUser(first);
  assert.equal((await first.get("/api/profile")).status(), 200);
  const session = await (await first.get("/api/auth/get-session")).json();
  assert.equal(session.session.ipAddress, "192.0.2.42");
  const second = await createContext("192.0.2.43");
  assert.equal(
    (
      await second.post("/api/auth/sign-in/email", {
        data: { email: user.email, password: user.password },
      })
    ).status(),
    200,
  );
  const secondSession = await (
    await second.get("/api/auth/get-session")
  ).json();
  assert.equal(secondSession.session.ipAddress, "192.0.2.43");
  assert.equal((await first.delete("/api/account")).status(), 200);
  const report = {
    date: new Date().toISOString().slice(0, 10),
    image: await docker("inspect", "--format", "{{.Image}}", name),
    unsignedAuthAndBusinessRequestsRejected: true,
    forgedSignatureRejected: true,
    invalidProviderIpRejected: true,
    signedLoginAndPrivateApiWork: true,
    untrustedIpOverridden: true,
    twoDistinctClientIpsRecorded: true,
    scope:
      "Local Docker HTTP simulation with synthetic signed Netlify claims; actual Netlify headers and public TLS remain unverified",
  };
  await writeFile(
    "docs/reports/netlify-gateway.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  for (const context of contexts) await context.dispose();
  await docker("rm", "-f", name).catch(() => {});
  await unlink(envFile).catch(() => {});
}
