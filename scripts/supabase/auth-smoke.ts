import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { settings, schema, identifier } from "./migration-config";
import { databaseConnection } from "../../apps/web/lib/database-connection";

// Uses a disposable confirmed user; does not send mail or touch existing accounts.
const values = await settings(process.argv[2] ?? ".env.supabase.local");
const origin = values.APP_URL;
const namespace = identifier(schema(values));
const admin = createClient(values.SUPABASE_URL, values.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pool = new Pool({
  ...databaseConnection({
    DATABASE_URL: values.DATABASE_URL,
    DATABASE_SSL_CA: values.DATABASE_SSL_CA,
  }),
  max: 1,
});
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const context = await browser.newContext();
let subject: string | undefined, owner: string | undefined;
const email = `migration-smoke-${randomUUID()}@example.test`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      ready = (
        await context.request.get(`${origin}/api/health/live`, {
          timeout: 1000,
        })
      ).ok();
    } catch {
      /* Server may still be starting. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("Synthetic smoke server did not become ready");
  const password = `Smoke-${randomUUID()}!`;
  const verified = await context.request.post(
    `${origin}/api/auth/sign-up/email`,
    {
      headers: { Origin: origin },
      data: {
        email,
        password,
        name: "Migration smoke test",
        teachingSubject: "mathematics",
      },
    },
  );
  if (!verified.ok())
    throw new Error(`Password signup failed (${verified.status()})`);
  const session = await (
    await context.request.get(`${origin}/api/auth/get-session`)
  ).json();
  owner = session?.user?.id;
  subject = (
    await pool.query(
      `SELECT subject FROM ${namespace}.auth_identities WHERE owner_id=$1`,
      [owner],
    )
  ).rows[0]?.subject;
  if (!owner || session.user.email !== email)
    throw new Error("Verified session missing");
  const originalCookies = await context.cookies();
  if (
    !originalCookies.some(
      (cookie) => cookie.name.startsWith("ziyatai-auth") && cookie.httpOnly,
    )
  )
    throw new Error("HttpOnly session cookie missing");
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator(".main-shell").waitFor({ state: "visible" });
  const profile = await context.request.get(`${origin}/api/profile`);
  if (
    !profile.ok() ||
    (await profile.json()).capabilities.authMode !== "password"
  )
    throw new Error("Password profile unavailable");
  const other = (
    await pool.query(
      `SELECT id FROM ${namespace}.plans WHERE owner_id<>$1 AND deleted_at IS NULL LIMIT 1`,
      [owner],
    )
  ).rows[0];
  if (other) {
    const forbidden = await context.request.get(
      `${origin}/api/ktp/${other.id}`,
    );
    if (![403, 404].includes(forbidden.status()))
      throw new Error("Another owner's plan was accessible");
  }
  const wrong = await context.request.post(
    `${origin}/api/auth/change-password`,
    {
      headers: { Origin: origin, "X-ZiyatAI-Account": owner },
      data: {
        currentPassword: "wrong-password",
        newPassword: `Next-${password}`,
      },
    },
  );
  if (wrong.status() !== 401)
    throw new Error("Password change accepted the wrong current password");
  const changed = await context.request.post(
    `${origin}/api/auth/change-password`,
    {
      headers: { Origin: origin, "X-ZiyatAI-Account": owner },
      data: { currentPassword: password, newPassword: `Next-${password}` },
    },
  );
  if (!changed.ok())
    throw new Error(`Password change failed (${changed.status()})`);
  if (values.PASSWORD_RESET_ENABLED === "true") {
    const recovery = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (recovery.error || !recovery.data.properties.hashed_token)
      throw new Error("Synthetic recovery link generation failed");
    const recovered = await context.request.get(
      `${origin}/api/auth/callback?type=recovery&token_hash=${encodeURIComponent(recovery.data.properties.hashed_token)}`,
      { maxRedirects: 0 },
    );
    if (
      recovered.status() !== 303 ||
      !recovered.headers().location?.endsWith("?auth=recovery")
    )
      throw new Error("Password recovery callback failed");
    const reset = await context.request.post(
      `${origin}/api/auth/reset-password`,
      {
        headers: { Origin: origin, "X-ZiyatAI-Account": owner },
        data: { newPassword: `Reset-${password}` },
      },
    );
    if (!reset.ok())
      throw new Error(`Password reset failed (${reset.status()})`);
    const resetSession = await (
      await context.request.get(`${origin}/api/auth/get-session`)
    ).json();
    if (resetSession !== null)
      throw new Error("Revoked recovery session still accepted");
    const login = await context.request.post(
      `${origin}/api/auth/sign-in/email`,
      {
        headers: { Origin: origin },
        data: { email, password: `Reset-${password}` },
      },
    );
    if (!login.ok()) throw new Error("Password login after recovery failed");
  }
  const logout = await context.request.post(`${origin}/api/auth/sign-out`, {
    headers: { Origin: origin, "X-ZiyatAI-Account": owner },
    data: {},
  });
  if (!logout.ok()) throw new Error("Sign-out failed");
  const staleContext = await browser.newContext();
  try {
    await staleContext.addCookies(originalCookies);
    const revoked = await (
      await staleContext.request.get(`${origin}/api/auth/get-session`)
    ).json();
    if (revoked !== null) throw new Error("Revoked session was still accepted");
  } finally {
    await staleContext.close();
  }
  console.log(
    JSON.stringify({
      passwordSignup: "passed",
      passwordSignIn: "passed",
      passwordChange: "passed",
      recoveryAndReset:
        values.PASSWORD_RESET_ENABLED === "true" ? "passed" : "disabled",
      httpOnlyCookies: "passed",
      workspace: "passed",
      ownership: other ? "passed" : "no-foreign-plan-fixture",
      sessionRevocation: "passed",
      emailDelivery: "not-tested",
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error &&
      /^(Synthetic|Password|Verified session|HttpOnly|Another owner|Sign-out|Revoked session)/.test(
        error.message,
      )
      ? error.message
      : "Browser authentication smoke check failed; inspect the local server logs.",
  );
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  if (!subject)
    subject = (
      await pool.query("SELECT id FROM auth.users WHERE email=$1", [email])
    ).rows[0]?.id;
  if (subject) {
    if (!owner)
      owner = (
        await pool.query(
          `SELECT owner_id FROM ${namespace}.auth_identities WHERE subject=$1`,
          [subject],
        )
      ).rows[0]?.owner_id;
    const removed = await admin.auth.admin.deleteUser(subject);
    if (removed.error) {
      console.error("Synthetic provider account cleanup failed");
      process.exitCode = 1;
    }
  }
  if (owner)
    await pool.query(`DELETE FROM ${namespace}."user" WHERE id=$1`, [owner]);
  await pool.end();
}
