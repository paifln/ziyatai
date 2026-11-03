/** Local fault injection against a synthetic user only; no production endpoint. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { auth } from "../apps/web/lib/auth";
import { db } from "../apps/web/lib/db";
import { env } from "../apps/web/lib/env";
const suffix = randomBytes(6).toString("hex"),
  name = `auth_reset_${suffix}`;
const email = `reset-fault-${suffix}@example.test`,
  password = randomBytes(20).toString("hex"),
  newPassword = randomBytes(20).toString("hex");
let owner = "";
assert.equal(
  env().APP_ENV,
  "local",
  "This fault injection is for a local test database only",
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(env().SMTP_HOST) &&
    env().SMTP_PORT === 1025,
  "Use the local Mailpit SMTP service for this check",
);
try {
  const user = await auth().api.signUpEmail({
    body: { name: "Synthetic reset fault test", email, password },
  });
  owner = user.user.id;
  assert.match(owner, /^[a-f0-9-]{36}$/i);
  await db().query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    owner,
  ]);
  const login = await auth().api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const oldHash = (
    await db().query('SELECT password FROM account WHERE "userId"=$1', [owner])
  ).rows[0].password;
  await auth().api.requestPasswordReset({
    body: { email, redirectTo: env().APP_URL + "/" },
  });
  let link = "";
  for (let i = 0; i < 20 && !link; i++) {
    const messages = await (
      await fetch("http://127.0.0.1:8025/api/v1/messages")
    ).json();
    const message = messages.messages?.find(
      (m: any) =>
        m.Subject.includes("Восстановление") &&
        m.To.some((to: any) => to.Address === email),
    );
    if (message) {
      const detail = await (
        await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)
      ).json();
      link = detail.Text.match(/https?:\/\/[^\s]+/)?.[0] || "";
    }
    if (!link) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(link, "Local password reset email was not delivered");
  const redirected = await auth().handler(new Request(link));
  const token = new URL(
    redirected.headers.get("location") || "",
    env().APP_URL,
  ).searchParams.get("token");
  assert.ok(token, "Reset token is missing");
  await db().query(
    `CREATE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic session revocation failure'; END $$`,
  );
  await db().query(
    `CREATE TRIGGER ${name} BEFORE DELETE ON session FOR EACH ROW WHEN (OLD."userId"='${owner}') EXECUTE FUNCTION ${name}_fn()`,
  );
  let failed = false;
  try {
    await auth().api.resetPassword({ body: { token, newPassword } });
  } catch {
    failed = true;
  }
  assert.ok(failed, "Injected session revocation failure was not observed");
  const unchanged = (
    await db().query('SELECT password FROM account WHERE "userId"=$1', [owner])
  ).rows[0].password;
  assert.ok(unchanged === oldHash, "Password changed despite a failed reset");
  assert.ok(
    await auth().api.getSession({ headers: new Headers({ cookie }) }),
    "Existing session disappeared after a failed reset",
  );
  await db().query(`DROP TRIGGER ${name} ON session`);
  await auth().api.resetPassword({ body: { token, newPassword } });
  assert.equal(
    await auth().api.getSession({ headers: new Headers({ cookie }) }),
    null,
    "Old session survived successful password reset",
  );
  const signedIn = await auth().api.signInEmail({
    body: { email, password: newPassword },
    asResponse: true,
  });
  assert.equal(signedIn.status, 200);
  const report = {
    betterAuth: JSON.parse(
      await readFile("node_modules/better-auth/package.json", "utf8"),
    ).version,
    date: new Date().toISOString().slice(0, 10),
    environment:
      "Local PostgreSQL, Better Auth and Mailpit; synthetic user only",
    failedResetPreservesPassword: true,
    failedResetPreservesSession: true,
    resetTokenReusableAfterFailure: true,
    successfulResetRevokesOldSession: true,
    newPasswordLoginWorks: true,
  };
  await writeFile(
    "docs/reports/auth-reset.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await db().query(`DROP TRIGGER IF EXISTS ${name} ON session`);
  await db().query(`DROP FUNCTION IF EXISTS ${name}_fn()`);
  if (owner) {
    await db().query("DELETE FROM verification WHERE value=$1", [owner]);
    await db().query('DELETE FROM "user" WHERE id=$1', [owner]);
  }
  await db().end();
}
