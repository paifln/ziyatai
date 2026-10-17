import { createHmac } from "node:crypto";
import { getIP } from "better-auth/api";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import type { PoolClient } from "pg";
import { db } from "./db";

export const sessionReadPolicy = { perMinute: 240, burst: 120 } as const;

export function sessionReadPath(requestUrl: string, baseUrl: string) {
  try {
    const path = decodeURIComponent(new URL(requestUrl).pathname).replace(
      /\/+$/,
      "",
    );
    const base = decodeURIComponent(new URL(baseUrl).pathname).replace(
      /\/+$/,
      "",
    );
    return path === `${base}/get-session`;
  } catch {
    return false;
  }
}

export function sessionReadKey(
  request: Request,
  options: BetterAuthOptions,
  secret: string,
) {
  const ip = getIP(request, options) ?? "no-trusted-ip";
  return createHmac("sha256", secret)
    .update(`auth-session-v1\0${ip}`)
    .digest("hex");
}

/** GCRA uses the database clock and one atomic admission across API replicas.
 * A denied read never extends the wait. Pruning is bounded and skips busy rows.
 */
export async function consumeSessionRead(
  key: string,
  connection: Pick<PoolClient, "query"> = db(),
) {
  const step = 60 / sessionReadPolicy.perMinute;
  const tolerance = (sessionReadPolicy.burst - 1) * step;
  const accepted = await connection.query(
    `
    WITH expired AS (
      SELECT key FROM auth_session_read_budgets
      WHERE available_at < statement_timestamp()-interval '15 minutes' AND key<>$1
      ORDER BY available_at,key LIMIT 32 FOR UPDATE SKIP LOCKED
    ), pruned AS (
      DELETE FROM auth_session_read_budgets b USING expired e WHERE b.key=e.key RETURNING b.key
    )
    INSERT INTO auth_session_read_budgets(key,available_at)
    VALUES($1,statement_timestamp()+$2::double precision*interval '1 second')
    ON CONFLICT(key) DO UPDATE
      SET available_at=GREATEST(auth_session_read_budgets.available_at,statement_timestamp())+$2::double precision*interval '1 second'
      WHERE auth_session_read_budgets.available_at<=statement_timestamp()+$3::double precision*interval '1 second'
    RETURNING 1
  `,
    [key, step, tolerance],
  );
  if (accepted.rowCount) return { allowed: true, retryAfter: 0 };
  const remaining = await connection.query(
    "SELECT GREATEST(1,ceil(extract(epoch FROM available_at-statement_timestamp())-$2))::int AS seconds FROM auth_session_read_budgets WHERE key=$1",
    [key, tolerance],
  );
  return { allowed: false, retryAfter: remaining.rows[0]?.seconds ?? 1 };
}

export function sessionReadBudget(secret: string): BetterAuthPlugin {
  return {
    id: "session-read-budget",
    async onRequest(request, context) {
      if (!sessionReadPath(request.url, context.baseURL)) return;
      const result = await consumeSessionRead(
        sessionReadKey(request, context.options, secret),
      );
      if (!result.allowed)
        return {
          response: Response.json(
            {
              code: "READ_LIMIT",
              message: "Too many session reads. Retry shortly.",
            },
            {
              status: 429,
              headers: {
                "Retry-After": String(result.retryAfter),
                "X-Retry-After": String(result.retryAfter),
                "Cache-Control": "private, no-store",
                Vary: "Cookie",
              },
            },
          ),
        };
    },
  };
}
