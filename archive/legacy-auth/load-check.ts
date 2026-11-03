import { request as requests } from "@playwright/test";
import { auth } from "../apps/web/lib/auth";
import { db } from "../apps/web/lib/db";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const contexts = [];
const timings: number[] = [];
for (let i = 0; i < 10; i++) {
  const email = `load-${randomBytes(5).toString("hex")}@example.test`,
    password = randomBytes(16).toString("hex");
  const user = await auth().api.signUpEmail({
    body: { name: "Synthetic load teacher", email, password },
  });
  await db().query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.user.id,
  ]);
  const context = await requests.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: {
      Origin: "http://localhost:3000",
      "X-Forwarded-For": `192.0.2.${i + 10}`,
    },
  });
  const login = await context.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
  if (!login.ok()) throw new Error("Load account login failed");
  contexts.push(context);
}
let failures = 0;
await Promise.all(
  contexts.map(async (c) => {
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const r = await c.get("/api/ktp");
      timings.push(performance.now() - start);
      if (!r.ok()) failures++;
    }
  }),
);
timings.sort((a, b) => a - b);
const report = {
  environment:
    "localhost, development build, real PostgreSQL; not production benchmark",
  teachers: 10,
  requests: timings.length,
  failures,
  p50ms: Math.round(timings[Math.floor(timings.length * 0.5)]),
  p95ms: Math.round(timings[Math.floor(timings.length * 0.95)]),
  maxMs: Math.round(timings.at(-1)!),
  externalOperations: "AI/OCR/export measured separately; AI unavailable",
};
await mkdir("docs/reports", { recursive: true });
await writeFile("docs/reports/load.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
for (const c of contexts) await c.dispose();
await db().end();
