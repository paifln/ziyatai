import { expect, it, vi } from "vitest";
import {
  assertAuthAccountIntent,
} from "../apps/web/lib/auth-account-intent";
import { accountIntentHeader } from "../packages/contracts/account-intent";

function request(path: string, owner?: string, method = "POST") {
  return new Request(`https://school.example.test/api/auth/${path}`, {
    method,
    headers: owner === undefined ? {} : { [accountIntentHeader]: owner },
  });
}

it("does not introduce a session dependency for unhinted login or canonical reads", async () => {
  const read = vi.fn(async () => null);
  for (const path of [
    "sign-in/email",
    "sign-up/email",
    "get-session",
  ])
    await assertAuthAccountIntent(request(path), read);
  expect(read).not.toHaveBeenCalled();
});

it("requires an explicit native action owner to match its authenticated session", async () => {
  const read = vi.fn(async () => ({ user: { id: "teacher-b" } }));
  for (const path of [
    "sign-out",
    "sign-out/",
    "%73ign-out",
    "change-password",
    "revoke-other-sessions",
    "list-sessions",
  ])
    await expect(
      assertAuthAccountIntent(request(path, "teacher-a"), read),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED", status: 409 });
  await expect(
    assertAuthAccountIntent(request("change-password", "teacher-b"), read),
  ).resolves.toBeUndefined();
});

it("allows anonymous POST sign-out cleanup but never grants an authenticated action", async () => {
  const read = async () => null;
  for (const path of ["sign-out", "sign-out/", "%73ign-out"])
    await expect(
      assertAuthAccountIntent(request(path, "teacher-a"), read),
    ).resolves.toBeUndefined();
  for (const path of [
    "change-password",
    "revoke-other-sessions",
    "sign-out-other",
    "other/sign-out",
    "%zz",
  ])
    await expect(
      assertAuthAccountIntent(request(path, "teacher-a"), read),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  await expect(
    assertAuthAccountIntent(request("sign-out", "teacher-a", "GET"), read),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
});

it("never admits a native action when canonical session lookup fails", async () => {
  await expect(
    assertAuthAccountIntent(request("sign-out", "teacher-a"), async () => {
      throw new Error("Synthetic database failure");
    }),
  ).rejects.toThrow("Synthetic database failure");
});
