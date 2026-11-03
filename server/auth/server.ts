import { createServerClient } from "@supabase/ssr";
import { createClient, type AuthError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../infrastructure/database/db";
import { provisionIdentity, readIdentity } from "./identity";
import { consumeSessionRead, sessionReadKey } from "../http/session-read-budget";
import { assertAccountIntent } from "../application/account-intent";
import { readJsonBody } from "../http/request-body";
import { AppError } from "../../packages/domain/errors";

const supabaseCookieName = "ziyatai-auth";

// Only server route handlers own Supabase tokens; the browser receives no JWT.
async function requestClient() {
  const e = env();
  const store = await cookies();
  return createServerClient(e.SUPABASE_URL, e.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: {
      name: supabaseCookieName,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: e.APP_URL.startsWith("https://"),
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        // All callers are route handlers; their responses are private/no-store.
        for (const { name, value, options } of values)
          store.set(name, value, options);
      },
    },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          cache: "no-store",
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        }),
    },
  });
}

function providerFailure(error: AuthError): never {
  if (error.status === 429) throw new AppError("LIMIT", 429);
  if (!error.status || error.status >= 500)
    throw new AppError("AUTH_UNAVAILABLE", 503);
  if (["email_exists", "user_already_exists"].includes(error.code ?? ""))
    throw new AppError("ACCOUNT_EXISTS", 409);
  throw new AppError("UNAUTHORIZED", 401);
}

// Decode only AFTER getUser validated the token with Supabase, never authorize
// using client-supplied JWT claims alone.
function verifiedSessionId(accessToken: string) {
  const claims = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString(),
  );
  return z.uuid().parse(claims.session_id);
}

async function current(client: Awaited<ReturnType<typeof requestClient>>) {
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (
      error.name === "AuthSessionMissingError" ||
      [400, 401, 403].includes(error.status ?? 0)
    )
      return null;
    providerFailure(error);
  }
  if (!data.user) return null;
  const token = await client.auth.getSession();
  if (token.error) providerFailure(token.error);
  if (!token.data.session) return null;
  const id = verifiedSessionId(token.data.session.access_token);
  const user = await readIdentity(data.user, id);
  if (!user) return null;
  return {
    user,
    session: {
      id,
      userId: user.id,
      expiresAt: new Date((token.data.session.expires_at ?? 0) * 1000),
    },
  };
}

export async function readSupabaseSession() {
  return current(await requestClient());
}

async function admit(
  action: string,
  identity: string,
  maximum: number,
  seconds: number,
) {
  const key = createHmac("sha256", env().AUTH_SECRET)
    .update(`supabase:${action}:${identity}`)
    .digest("hex");
  const window = new Date(
    Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000,
  );
  const result = await db().query(
    `INSERT INTO api_limits(key,window_start,count) VALUES($1,$2,1)
     ON CONFLICT(key,window_start) DO UPDATE SET count=api_limits.count+1 RETURNING count`,
    [key, window],
  );
  if (result.rows[0].count > maximum) throw new AppError("LIMIT", 429);
}

function recoverySignature(value: string) {
  return createHmac("sha256", env().AUTH_SECRET)
    .update(`recovery:${value}`)
    .digest("hex");
}

const emailInput = z.string().trim().toLowerCase().email().max(254);
const detailsInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  teachingSubject: z.string().trim().min(1).max(120).optional(),
});

export async function handleSupabaseAuth(request: Request) {
  const path = new URL(request.url).pathname
    .replace(/\/+$/, "")
    .slice("/api/auth/".length);
  const respond = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        Pragma: "no-cache",
      },
    });
  if (request.method === "GET" && path === "callback") {
    const url = new URL(request.url);
    const client = await requestClient();
    if (!env().PASSWORD_RESET_ENABLED)
      return respond({ code: "NOT_FOUND" }, 404);
    const type = url.searchParams.get("type");
    const hash = url.searchParams.get("token_hash");
    const code = url.searchParams.get("code");
    const result =
      hash && type === "recovery"
        ? await client.auth.verifyOtp({
            token_hash: hash,
            type: "recovery",
          })
        : code
          ? await client.auth.exchangeCodeForSession(code)
          : null;
    if (!result || result.error || !result.data.user || !result.data.session) {
      return Response.redirect(`${env().APP_URL}/?auth=error`, 303);
    }
    const id = verifiedSessionId(result.data.session.access_token);
    try {
      await provisionIdentity(
        result.data.user,
        id,
        detailsInput.parse({
          name:
            typeof result.data.user.user_metadata?.name === "string"
              ? result.data.user.user_metadata.name.slice(0, 100) || undefined
              : undefined,
          teachingSubject:
            typeof result.data.user.user_metadata?.teachingSubject === "string"
              ? result.data.user.user_metadata.teachingSubject.slice(0, 120) ||
                undefined
              : undefined,
        }),
        true,
      );
      if (
        type === "recovery" ||
        ("redirectType" in result.data &&
          result.data.redirectType === "recovery")
      ) {
        const proof = `${id}.${Date.now() + 10 * 60 * 1000}`;
        (await cookies()).set(
          "ziyatai-recovery",
          `${proof}.${recoverySignature(proof)}`,
          {
            httpOnly: true,
            sameSite: "lax",
            secure: env().APP_URL.startsWith("https://"),
            path: "/",
            maxAge: 600,
          },
        );
        return Response.redirect(`${env().APP_URL}/?auth=recovery`, 303);
      }
      return Response.redirect(`${env().APP_URL}/`, 303);
    } catch (error) {
      await client.auth.signOut({ scope: "local" });
      throw error;
    }
  }
  if (request.method === "GET" && path === "get-session") {
    const budget = await consumeSessionRead(
      sessionReadKey(request, {}, env().AUTH_SECRET),
    );
    if (!budget.allowed)
      return new Response(JSON.stringify({ code: "READ_LIMIT" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(budget.retryAfter),
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      });
    return respond(await readSupabaseSession());
  }
  if (request.method !== "POST") return respond({ code: "NOT_FOUND" }, 404);
  if (request.headers.get("origin") !== env().APP_URL)
    throw new AppError("CSRF", 403);
  if (
    ["sign-in/email", "sign-up/email", "request-password-reset"].includes(path)
  ) {
    await admit(
      "network",
      sessionReadKey(request, {}, env().AUTH_SECRET),
      60,
      600,
    );
  }
  const client = await requestClient();
  if (["sign-in/email", "sign-up/email"].includes(path)) {
    const signup = path === "sign-up/email";
    const input = z
      .object({
        email: emailInput,
        password: z
          .string()
          .min(signup ? 12 : 1)
          .max(128),
        ...detailsInput.shape,
      })
      .parse(await readJsonBody(request));
    await admit("password", input.email, 15, 600);
    if (signup) {
      const existing = await db().query(
        'SELECT 1 FROM "user" WHERE lower(email)=$1 LIMIT 1',
        [input.email],
      );
      if (existing.rowCount) throw new AppError("ACCOUNT_EXISTS", 409);
      // Registration intentionally skips email confirmation. The secret key stays on this rate-limited server route.
      const admin = createClient(
        env().SUPABASE_URL,
        env().SUPABASE_SECRET_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const created = await admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: {
          name: input.name,
          teachingSubject: input.teachingSubject,
        },
      });
      if (created.error) providerFailure(created.error);
    }
    const result = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (result.error) providerFailure(result.error);
    if (!result.data.session) throw new AppError("UNAUTHORIZED", 401);
    if (!result.data.user) throw new AppError("UNAUTHORIZED", 401);
    try {
      await provisionIdentity(
        result.data.user,
        verifiedSessionId(result.data.session.access_token),
        input,
      );
    } catch (error) {
      await client.auth.signOut({ scope: "local" });
      throw error;
    }
    return respond({ success: true });
  }
  if (path === "request-password-reset") {
    if (!env().PASSWORD_RESET_ENABLED)
      return respond({ code: "NOT_FOUND" }, 404);
    const input = z
      .object({ email: emailInput })
      .parse(await readJsonBody(request));
    await admit("reset", input.email, 3, 600);
    const { error } = await client.auth.resetPasswordForEmail(input.email, {
      redirectTo: `${env().APP_URL}/api/auth/callback`,
    });
    if (error) providerFailure(error);
    return respond({ sent: true });
  }
  if (["change-password", "reset-password"].includes(path)) {
    if (path === "reset-password" && !env().PASSWORD_RESET_ENABLED)
      return respond({ code: "NOT_FOUND" }, 404);
    const session = await current(client);
    if (!session) throw new AppError("UNAUTHORIZED", 401);
    assertAccountIntent(request.headers, session.user.id);
    const input = z
      .object({
        newPassword: z.string().min(12).max(128),
        currentPassword: z.string().min(1).max(128).optional(),
      })
      .parse(await readJsonBody(request));
    await admit("change-password", session.user.id, 5, 600);
    if (path === "change-password") {
      if (!input.currentPassword) throw new AppError("UNAUTHORIZED", 401);
      // Verify the old password in an isolated client; never rotate this browser's session during reauthentication.
      const verifier = createClient(
        env().SUPABASE_URL,
        env().SUPABASE_PUBLISHABLE_KEY,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (url, init) =>
              fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
          },
        },
      );
      const checked = await verifier.auth.signInWithPassword({
        email: session.user.email,
        password: input.currentPassword,
      });
      if (checked.error) providerFailure(checked.error);
      if (
        !checked.data.user ||
        checked.data.user.id !== (await client.auth.getUser()).data.user?.id
      )
        throw new AppError("UNAUTHORIZED", 401);
      await verifier.auth.signOut({ scope: "local" });
    } else {
      const proof = (await cookies()).get("ziyatai-recovery")?.value ?? "";
      const [id, expiry, signature] = proof.split(".");
      const expected = recoverySignature(`${id}.${expiry}`);
      if (
        id !== session.session.id ||
        !Number.isFinite(Number(expiry)) ||
        Number(expiry) < Date.now() ||
        !signature ||
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        throw new AppError("UNAUTHORIZED", 401);
    }
    const { error } = await client.auth.updateUser({
      password: input.newPassword,
    });
    if (error) providerFailure(error);
    await db().query(
      path === "reset-password"
        ? "UPDATE auth_sessions SET revoked_at=now() WHERE owner_id=$1 AND revoked_at IS NULL AND $2::uuid IS NOT NULL"
        : "UPDATE auth_sessions SET revoked_at=now() WHERE owner_id=$1 AND id<>$2 AND revoked_at IS NULL",
      [session.user.id, session.session.id],
    );
    const revoked = await client.auth.signOut({
      scope: path === "reset-password" ? "global" : "others",
    });
    if (revoked.error) providerFailure(revoked.error);
    (await cookies()).delete("ziyatai-recovery");
    return respond({ success: true });
  }
  if (["sign-out", "revoke-other-sessions"].includes(path)) {
    const session = await current(client);
    if (session) {
      assertAccountIntent(request.headers, session.user.id);
      await db().query(
        path === "sign-out"
          ? "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND owner_id=$2"
          : "UPDATE auth_sessions SET revoked_at=now() WHERE id<>$1 AND owner_id=$2 AND revoked_at IS NULL",
        [session.session.id, session.user.id],
      );
    } else if (path !== "sign-out") throw new AppError("UNAUTHORIZED", 401);
    const { error } = await client.auth.signOut({
      scope: path === "sign-out" ? "local" : "others",
    });
    if (error && error.status !== 401 && error.status !== 403)
      providerFailure(error);
    return respond({ success: true });
  }
  return respond({ code: "NOT_FOUND" }, 404);
}
