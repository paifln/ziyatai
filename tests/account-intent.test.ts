import { afterEach, expect, it, vi } from "vitest";
import { accountIntentHeader } from "../packages/contracts/account-intent";
import { assertAccountIntent } from "../server/application/account-intent";
import { createAccountClient } from "../apps/web/lib/client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requires both an authentic session owner and a matching explicit intent", () => {
  expect(() =>
    assertAccountIntent(
      new Headers({ [accountIntentHeader]: "teacher-a" }),
      "teacher-a",
    ),
  ).not.toThrow();
  for (const expected of ["teacher-b", "", "teacher-a, teacher-b"]) {
    expect(() =>
      assertAccountIntent(
        new Headers({ [accountIntentHeader]: expected }),
        "teacher-a",
      ),
    ).toThrow(
      expect.objectContaining({ code: "SESSION_CHANGED", status: 409 }),
    );
  }
  // Existing direct clients still rely on the authenticated session and ownership checks.
  expect(() => assertAccountIntent(new Headers(), "teacher-a")).not.toThrow();
});

it("captures each account independently for delayed writes and reads", async () => {
  vi.stubGlobal("document", { documentElement: { lang: "ru" } });
  const transport = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", transport);
  const first = createAccountClient("teacher-a");
  const second = createAccountClient("teacher-b");
  await second.api("profile");
  await first.api(
    "profile",
    "PATCH",
    { school: "Synthetic old intent" },
    "synthetic-write-key",
  );
  const requests = transport.mock.calls as unknown as [
    RequestInfo,
    RequestInit,
  ][];
  expect(new Headers(requests[0][1].headers).get(accountIntentHeader)).toBe(
    "teacher-b",
  );
  expect(new Headers(requests[1][1].headers).get(accountIntentHeader)).toBe(
    "teacher-a",
  );
  expect(new Headers(requests[1][1].headers).get("Idempotency-Key")).toBe(
    "synthetic-write-key",
  );
});

it("refreshes canonical session after a mismatch without replaying the write", async () => {
  vi.stubGlobal("document", { documentElement: { lang: "ru" } });
  const transport = vi.fn(async () =>
    Response.json({ code: "SESSION_CHANGED" }, { status: 409 }),
  );
  vi.stubGlobal("fetch", transport);
  const refresh = vi.fn();
  await expect(
    createAccountClient("teacher-a", refresh).api("account", "DELETE"),
  ).rejects.toMatchObject({ code: "SESSION_CHANGED", status: 409 });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("binds multipart uploads without replacing the browser content-type boundary", async () => {
  vi.stubGlobal("document", { documentElement: { lang: "ru" } });
  const transport = vi.fn(async () =>
    Response.json({ id: "synthetic-upload" }),
  );
  vi.stubGlobal("fetch", transport);
  await createAccountClient("teacher-a").uploadFile(
    new File(["synthetic"], "sample.pdf"),
    false,
  );
  const requests = transport.mock.calls as unknown as [
    RequestInfo,
    RequestInit,
  ][];
  const headers = new Headers(requests[0][1].headers);
  expect(headers.get(accountIntentHeader)).toBe("teacher-a");
  expect(headers.has("Content-Type")).toBe(false);
  expect(requests[0][1].body).toBeInstanceOf(FormData);
});

it("keeps the same owner for signed-upload initialization and completion", async () => {
  vi.stubGlobal("document", { documentElement: { lang: "ru" } });
  const storageHeaders: string[] = [];
  class StorageRequest {
    upload = {};
    status = 200;
    onload?: () => void;
    onloadend?: () => void;
    open() {}
    setRequestHeader(name: string) {
      storageHeaders.push(name);
    }
    send() {
      queueMicrotask(() => {
        this.onload?.();
        this.onloadend?.();
      });
    }
  }
  vi.stubGlobal("XMLHttpRequest", StorageRequest);
  const transport = vi.fn(async (path: string) =>
    Response.json(
      path.endsWith("/init")
        ? {
            id: "synthetic-upload",
            url: "https://storage.example.test/signed",
            contentType: "application/pdf",
          }
        : { id: "synthetic-upload" },
    ),
  );
  vi.stubGlobal("fetch", transport);
  await createAccountClient("teacher-a").uploadFile(
    new File(["synthetic"], "sample.pdf"),
    true,
  );
  const calls = transport.mock.calls as unknown as [string, RequestInit][];
  expect(calls.map(([path]) => path)).toEqual([
    "/api/uploads/init",
    "/api/uploads/synthetic-upload/complete",
  ]);
  expect(
    calls.map(([, init]) => new Headers(init.headers).get(accountIntentHeader)),
  ).toEqual(["teacher-a", "teacher-a"]);
  expect(storageHeaders).toEqual(["Content-Type"]);
});

it("native SDK commands retain captured intent and refresh only on a rejected owner", async () => {
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000/api/auth");
  vi.resetModules();
  const transport = vi.fn(async () =>
    Response.json(
      { code: "SESSION_CHANGED", message: "Synthetic account change" },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", transport);
  const { createAccountClient: nativeClient, authClient: canonicalClient } =
    await import("../apps/web/lib/client");
  const refresh = vi.fn();
  const first = nativeClient("teacher-a", refresh);
  const second = nativeClient("teacher-b", refresh);
  expect(
    (
      await first.auth.changePassword({
        currentPassword: "synthetic-current",
        newPassword: "synthetic-next",
      })
    ).error?.code,
  ).toBe("SESSION_CHANGED");
  expect((await second.auth.revokeOtherSessions()).error?.code).toBe(
    "SESSION_CHANGED",
  );
  expect((await first.auth.signOut()).error?.code).toBe("SESSION_CHANGED");
  await canonicalClient.getSession();
  const calls = transport.mock.calls as unknown as [string, RequestInit][];
  expect(
    calls.map(([path]) => new URL(path, "http://localhost").pathname),
  ).toEqual([
    "/api/auth/change-password",
    "/api/auth/revoke-other-sessions",
    "/api/auth/sign-out",
    "/api/auth/get-session",
  ]);
  expect(
    calls.map(([, init]) => new Headers(init.headers).get(accountIntentHeader)),
  ).toEqual(["teacher-a", "teacher-b", "teacher-a", null]);
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(transport).toHaveBeenCalledTimes(4);
});
