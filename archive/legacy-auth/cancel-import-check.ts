import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { env } from "../apps/web/lib/env";
import { auth } from "../apps/web/lib/auth";
import { db } from "../apps/web/lib/db";
assert.equal(env().APP_ENV, "local");
assert.ok(
  ["localhost", "127.0.0.1"].includes(env().SMTP_HOST) &&
    env().SMTP_PORT === 1025,
  "Use local Mailpit only",
);
const origin = "http://localhost:3000",
  email = "cancel-" + randomBytes(6).toString("hex") + "@example.test";
const user = await auth().api.signUpEmail({
  body: {
    email,
    password: randomBytes(18).toString("hex"),
    name: "Synthetic cancellation QA",
  },
});
assert.ok(user.user.id);
const list = await (
  await fetch("http://127.0.0.1:8025/api/v1/messages")
).json();
const m = list.messages.find((m: any) =>
  m.To.some((t: any) => t.Address === email),
);
assert.ok(m);
const mail = await (
  await fetch("http://127.0.0.1:8025/api/v1/message/" + m.ID)
).json();
const otp = mail.Text.match(/\b\d{6}\b/)[0];
const verified = await auth().handler(
  new Request(origin + "/api/auth/email-otp/verify-email", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp }),
  }),
);
assert.equal(verified.status, 200);
const cookie = verified.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
const plan = randomUUID(),
  job = randomUUID(),
  owner = user.user.id;
const c = await db().connect();
try {
  await c.query("BEGIN");
  await c.query("INSERT INTO plans(id,owner_id,title) VALUES($1,$2,$3)", [
    plan,
    owner,
    "Synthetic queued cancellation",
  ]);
  await c.query(
    "INSERT INTO jobs(id,owner_id,kind,resource_id,idempotency_key,available_at) VALUES($1,$2,'import',$3,$4,now()+interval '1 day')",
    [job, owner, plan, randomUUID()],
  );
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
}
const response = await fetch(origin + "/api/jobs/" + job + "/cancel", {
  method: "POST",
  headers: {
    Origin: origin,
    "Content-Type": "application/json",
    Cookie: cookie,
  },
  body: "{}",
});
assert.equal(response.status, 200);
const state = (
  await db().query(
    "SELECT j.status AS job,p.status AS plan FROM jobs j JOIN plans p ON p.id=j.resource_id WHERE j.id=$1",
    [job],
  )
).rows[0];
assert.deepEqual(state, { job: "cancelled", plan: "cancelled" });
const report = {
  date: new Date().toISOString(),
  scope: "Synthetic future queued import against the running local HTTP API",
  sourceCommit: process.env.QA_SOURCE_COMMIT || "unspecified",
  httpStatus: response.status,
  jobState: state.job,
  planState: state.plan,
  noWorkerClaimPossibleBeforeCancellation: true,
};
await writeFile(
  "docs/reports/import-cancel.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
await db().end();
