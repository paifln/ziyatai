import { accountIntentHeader } from "../../../packages/contracts/account-intent";
import { AppError } from "../../../packages/domain/errors";
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
