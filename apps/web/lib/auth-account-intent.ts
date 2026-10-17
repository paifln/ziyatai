import { accountIntentHeader } from "../../../packages/contracts/account-intent";
import { AppError, messages } from "../../../packages/domain/errors";
import type { BetterAuthPlugin } from "better-auth";
import { assertAccountIntent } from "./account-intent";

/** An invalidated session may still clear its own stale sign-out cookie. */
function anonymousSignOut(request: Request) {
  try {
    return (
      request.method === "POST" &&
      decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, "") ===
        "/api/auth/sign-out"
    );
  } catch {
    return false;
  }
}

export async function assertAuthAccountIntent(
  request: Request,
  readSession: () => Promise<{ user: { id: string } } | null>,
) {
  if (!request.headers.has(accountIntentHeader)) return;
  const session = await readSession();
  if (session) assertAccountIntent(request.headers, session.user.id);
  else if (!anonymousSignOut(request)) throw new AppError("UNAUTHORIZED", 401);
}

/** Native rate limiting runs before SDK onRequest plugins. */
export function authAccountIntent(
  readSession: (request: Request) => Promise<{ user: { id: string } } | null>,
): BetterAuthPlugin {
  return {
    id: "account-intent",
    async onRequest(request) {
      try {
        await assertAuthAccountIntent(request, () => readSession(request));
      } catch (error) {
        const known = error instanceof AppError;
        return {
          response: Response.json(
            {
              code: known ? error.code : "AUTH_UNAVAILABLE",
              message: known
                ? (messages[error.code] ?? messages.INTERNAL)
                : "Authentication is temporarily unavailable",
            },
            {
              status: known ? error.status : 503,
              headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
            },
          ),
        };
      }
    },
  };
}
