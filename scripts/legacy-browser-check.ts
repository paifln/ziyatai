/** Optional Windows QA with a separately extracted official Firefox ESR 115. */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { access, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
const browserBinary = resolve(
  process.env.LEGACY_FIREFOX || ".local/browsers/firefox115/core/firefox.exe",
);
const driverBinary = resolve(
  process.env.LEGACY_GECKODRIVER ||
    ".local/browsers/geckodriver/geckodriver.exe",
);
await access(browserBinary);
await access(driverBinary);
await mkdir(".local/qa", { recursive: true });
const server = createServer();
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
await new Promise<void>((done) => server.close(() => done()));
const driver = spawn(
  driverBinary,
  ["--host", "127.0.0.1", "--port", String(port), "--log", "error"],
  { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] },
);
const driverOrigin = `http://127.0.0.1:${port}`;
const base = "http://localhost:3000";
const api = await request.newContext({ baseURL: base });
let session = "";
async function wd(path: string, body?: unknown, method?: string) {
  const response = await fetch(driverOrigin + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(40000),
  });
  const data = await response.json();
  if (data.value?.error)
    throw new Error(`${data.value.error}: ${data.value.message.slice(0, 500)}`);
  return data.value;
}
async function until(check: () => Promise<unknown>, limit = 30000) {
  const deadline = Date.now() + limit;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (e) {
      error = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw error || new Error("Legacy browser check timed out");
}
const call = (path: string, body?: unknown, method?: string) =>
  wd(`/session/${session}${path}`, body, method);
const execute = (script: string, args: unknown[] = []) =>
  call("/execute/sync", { script, args });
async function element(using: string, value: string) {
  return (await call("/element", { using, value }))[
    "element-6066-11e4-a52e-4f735466cecf"
  ] as string;
}
async function click(label: string) {
  const id = await element("xpath", `//button[normalize-space(.)="${label}"]`);
  await call(`/element/${id}/click`, {});
}
async function fill(selector: string, value: string) {
  const id = await element("css selector", selector);
  await call(`/element/${id}/clear`, {});
  await call(`/element/${id}/value`, { text: value });
}
async function screenshot(name: string) {
  await writeFile(
    `.local/qa/${name}.png`,
    Buffer.from(await call("/screenshot"), "base64"),
  );
}
try {
  await until(async () => {
    if (driver.exitCode !== null) throw new Error("geckodriver exited");
    return (await wd("/status")).ready;
  });
  const created = await wd("/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "firefox",
        "moz:firefoxOptions": {
          binary: browserBinary,
          args: ["-headless"],
          prefs: {
            "app.update.auto": false,
            "app.update.enabled": false,
            "browser.shell.checkDefaultBrowser": false,
            "datareporting.policy.dataSubmissionEnabled": false,
            "toolkit.telemetry.enabled": false,
          },
        },
      },
    },
  });
  session = created.sessionId;
  assert.match(created.capabilities.browserVersion, /^115\./);
  console.log(
    `Testing actual Firefox ${created.capabilities.browserVersion} with an isolated profile.`,
  );
  const email = `legacy-${randomBytes(5).toString("hex")}@example.test`,
    password = randomBytes(16).toString("hex"),
    headers = { Origin: base };
  const signed = await api.post("/api/auth/sign-up/email", {
    headers,
    data: { email, password, name: "Legacy QA Teacher", callbackURL: "/lite/" },
  });
  assert.equal(signed.ok(), true);
  let mailLink = "";
  await until(async () => {
    const data = await (
      await api.get("http://127.0.0.1:8025/api/v1/messages")
    ).json();
    const mail = data.messages?.find((m: { To: { Address: string }[] }) =>
      m.To.some((to) => to.Address === email),
    );
    if (!mail) return false;
    const detail = await (
      await api.get(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)
    ).json();
    mailLink = detail.Text.match(/https?:\/\/[^\s]+/)?.[0] || "";
    return !!mailLink;
  });
  assert.equal((await api.get(mailLink)).ok(), true);
  await call("/url", { url: base + "/lite/" });
  await until(() =>
    execute("return !!document.querySelector('input[type=email]')"),
  );
  await fill("input[type=email]", email);
  await fill("input[type=password]", password);
  await click("Кіру");
  await until(() =>
    execute("return !document.getElementById('navigation').hidden"),
  );
  await call("/url", { url: base + "/" });
  await until(() =>
    execute("return !!document.querySelector('.main-content h1')"),
  );
  await call("/window/rect", { width: 1440, height: 1000 });
  await screenshot("firefox115-workspace");
  const main = {
    width: await execute("return innerWidth"),
    height: await execute("return innerHeight"),
    heading: await execute(
      "return document.querySelector('.main-content h1').textContent",
    ),
    overflow: await execute(
      "return document.documentElement.scrollWidth>innerWidth",
    ),
  };
  assert.equal(main.overflow, false);
  await call("/url", { url: base + "/lite/" });
  await until(() =>
    execute("return !document.getElementById('navigation').hidden"),
  );
  await click("Русский");
  await click("Загрузить КТП");
  const input = await element("css selector", "input[type=file]");
  await call(`/element/${input}/value`, {
    text: resolve("tests/fixtures/ru-table-1.docx"),
  });
  await click("Извлечь строки");
  await until(async () => {
    if (
      await execute(
        "return !!document.querySelector('#content select[aria-label=\"Класс\"]')",
      )
    )
      return true;
    try {
      await click("Обновить");
    } catch {}
    return false;
  });
  const gradeOption = await element(
    "css selector",
    '#content select[aria-label="Класс"] option[value="7"]',
  );
  await call(`/element/${gradeOption}/click`, {});
  await fill("#content .fields input", "2026–2027");
  await click("Подтвердить КТП");
  await until(() =>
    execute(
      "return Array.prototype.some.call(document.querySelectorAll('button'),function(b){return b.textContent==='Создать задания';})",
    ),
  );
  await call("/window/rect", { width: 360, height: 900 });
  const lite = {
    width: await execute("return innerWidth"),
    height: await execute("return innerHeight"),
    overflow: await execute(
      "return document.documentElement.scrollWidth>innerWidth",
    ),
    nextScripts: await execute(
      "return Array.prototype.filter.call(document.scripts,function(s){return s.src.indexOf('/_next/')>=0;}).length",
    ),
  };
  assert.equal(lite.overflow, false);
  assert.equal(lite.nextScripts, 0);
  await screenshot("firefox115-lite-review");
  await click("Задания");
  await until(() =>
    execute(
      "return Array.prototype.some.call(document.querySelectorAll('button'),function(b){return b.textContent==='Синтетический образец (без AI)';})",
    ),
  );
  await click("Синтетический образец (без AI)");
  await until(() =>
    execute("return document.querySelectorAll('.task').length===9"),
  );
  await click("Редактировать 1");
  await fill("#content textarea", "Firefox 115: к числу 2 прибавьте 3.");
  await click("Сохранить");
  await until(() =>
    execute(
      "return document.querySelectorAll('.task').length===9 && document.querySelector('.task').textContent.indexOf('Firefox 115:')>=0",
    ),
  );
  const review = await element("css selector", "#content input[type=checkbox]");
  await call(`/element/${review}/click`, {});
  await click("DOCX");
  await until(async () => {
    if (
      await execute("return !!document.querySelector('a[href*=\"/download\"]')")
    )
      return true;
    try {
      await click("Обновить");
    } catch {}
    return false;
  });
  const download = await execute(
    "return document.querySelector('a[href*=\"/download\"]').getAttribute('href')",
  );
  const file = await api.get(download);
  assert.equal(file.ok(), true);
  assert.match(file.headers()["content-type"], /wordprocessingml/);
  const report = {
    date: "2026-10-15",
    browser: created.capabilities.browserVersion,
    driver: "0.35.0",
    binary: "Official Mozilla Firefox ESR 115, win32",
    host: "Current Windows host, not a physical Windows 7 PC",
    main,
    lite,
    importConfirmed: true,
    taskEdited: true,
    teacherReviewAcknowledged: true,
    docxExported: true,
    limitations: [
      "Does not verify Windows 7 OS TLS, fonts, drivers or hardware performance",
      "Live OpenAI is not configured",
    ],
  };
  await writeFile(
    "docs/reports/legacy-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (session) await call("", undefined, "DELETE").catch(() => {});
  driver.kill();
  await api.dispose();
}
