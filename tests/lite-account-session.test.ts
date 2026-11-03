import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function setup() {
  const root: any = {};
  runInNewContext(readFileSync("public/lite/account-session.js", "utf8"), {
    window: root,
  });
  const changed = vi.fn();
  const request = vi.fn();
  const account = root.ZiyatLiteAccount({ changed, request });
  const xhr = () => ({ abort: vi.fn(), setRequestHeader: vi.fn() });
  return { account, changed, request, xhr };
}

it("binds business and protected auth requests but never storage or canonical session reads", () => {
  const { account, xhr } = setup();
  account.bind("teacher-a");
  for (const path of [
    "profile",
    "ktp/one/rows",
    "drafts",
    "uploads",
    "auth/sign-out",
    "auth/change-password",
    "auth/revoke-other-sessions",
  ]) {
    const value = xhr();
    expect(account.track(value, path)).toBe(true);
    expect(value.setRequestHeader).toHaveBeenCalledWith(
      "X-ZiyatAI-Account",
      "teacher-a",
    );
  }
  for (const path of [
    undefined,
    "public-config",
    "auth/get-session",
    "auth/sign-in/email",
  ]) {
    const value = xhr();
    account.track(value, path);
    expect(value.setRequestHeader).not.toHaveBeenCalled();
  }
});

it("coalesces revalidation and preserves the same owner's unsaved work after transient failures", () => {
  const { account, request, changed } = setup();
  account.bind("teacher-a");
  account.verify();
  account.verify();
  expect(request).toHaveBeenCalledTimes(1);
  request.mock.calls[0][3]("Temporary failure", undefined, 503);
  account.verify();
  request.mock.calls[1][3](null, { user: { id: "teacher-a" } });
  expect(changed).not.toHaveBeenCalled();
  expect(account.active()).toBe(true);
});

it.each([null, { user: { id: "teacher-b" } }])(
  "clears the old lifetime on a canonical account change (%j)",
  (session) => {
    const { account, request, changed, xhr } = setup();
    account.bind("teacher-a");
    const pending = xhr();
    const finished = xhr();
    account.track(pending, "profile");
    account.track(finished, "ktp");
    account.finish(finished);
    // Even synchronously delivered abort callbacks cannot revive old UI.
    pending.abort.mockImplementation(() =>
      expect(account.finish(pending)).toBe(false),
    );
    account.verify();
    request.mock.calls[0][3](null, session);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(pending.abort).toHaveBeenCalledTimes(1);
    expect(finished.abort).not.toHaveBeenCalled();
    expect(account.finish(finished)).toBe(false);
    expect(account.track(xhr(), "profile")).toBe(false);
    account.verify();
    account.bind("teacher-b");
    expect(account.active()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it("handles rejected owner intent once without replaying a mutation or comparing drafts", () => {
  const { account, request, changed } = setup();
  account.bind("teacher-a");
  expect(account.reject("ktp/one/rows", 409, "CONFLICT")).toBe(false);
  expect(account.reject("ktp/one/rows", 409, "SESSION_CHANGED")).toBe(true);
  account.reject("profile", 401, "UNAUTHORIZED");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

it("distinguishes expired business access from a rejected anonymous login", () => {
  const { account, changed } = setup();
  expect(account.reject("auth/sign-in/email", 401, "UNAUTHORIZED")).toBe(false);
  account.bind("teacher-a");
  expect(account.reject("profile", 401, "UNAUTHORIZED")).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
});
