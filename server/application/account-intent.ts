import { accountIntentHeader } from "../../packages/contracts/account-intent";
import { AppError } from "../../packages/domain/errors";

/** Session cookies remain authoritative. An explicit UI owner must also match. */
export function assertAccountIntent(
  headers: Headers,
  authenticatedOwner: string,
) {
  const expected = headers.get(accountIntentHeader);
  if (expected !== null && expected !== authenticatedOwner)
    throw new AppError("SESSION_CHANGED", 409);
}
