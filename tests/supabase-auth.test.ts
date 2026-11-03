import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  provision: vi.fn(),
  read: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  set: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../apps/web/lib/env", () => ({
  env: () => ({
    APP_URL: "https://school.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    AUTH_SECRET: "a".repeat(32),
  }),
}));
vi.mock("../apps/web/lib/db", () => ({ db: () => ({ query: fixture.query }) }));
vi.mock("../apps/web/lib/auth/identity", () => ({
  provisionIdentity: fixture.provision,
  readIdentity: fixture.read,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    delete: vi.fn(),
    set: fixture.set,
  }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: fixture.create }));
import {
  handleSupabaseAuth,
  readSupabaseSession,
} from "../apps/web/lib/auth/server";

const sid = "6595ca24-87e5-45ce-bc7a-4ae28bf3bd4a";
const token = `header.${Buffer.from(JSON.stringify({ session_id: sid })).toString("base64url")}.signature`;
function request(
  path: string,
  body: unknown = {},
  origin = "https://school.example",
) {
  return new Request(`https://school.example/api/auth/${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture.query.mockResolvedValue({ rows: [{ count: 1 }] });
  fixture.signInWithPassword.mockResolvedValue({
    data: { user: { id: "provider-user" }, session: { access_token: token } },
    error: null,
  });
  fixture.signOut.mockResolvedValue({ error: null });
  fixture.create.mockReturnValue({
    auth: {
      getUser: fixture.getUser,
      getSession: fixture.getSession,
      signInWithPassword: fixture.signInWithPassword,
      signUp: fixture.signUp,
      updateUser: fixture.updateUser,
      resetPasswordForEmail: fixture.resetPasswordForEmail,
      exchangeCodeForSession: fixture.exchangeCodeForSession,
      verifyOtp: fixture.verifyOtp,
      signOut: fixture.signOut,
    },
  });
});

it("authenticates with a password, binds only a confirmed identity and never returns tokens", async () => {
  const response = await handleSupabaseAuth(
    request("sign-in/email", {
      email: "Test@example.test",
      password: "synthetic-password",
    }),
  );
  expect(fixture.signInWithPassword).toHaveBeenCalledWith({
    email: "test@example.test",
    password: "synthetic-password",
  });
  expect(fixture.provision).toHaveBeenCalledWith(
    { id: "provider-user" },
    sid,
    expect.objectContaining({ email: "test@example.test" }),
  );
  expect(await response.json()).toEqual({ success: true });
  expect(fixture.create.mock.calls[0][2].cookieOptions).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });
});
it("requires confirmation before provisioning a new signup without a session", async () => {
  fixture.signUp.mockResolvedValue({
    data: { user: { id: "provider-user" }, session: null },
    error: null,
  });
  const response = await handleSupabaseAuth(
    request("sign-up/email", {
      email: "test@example.test",
      password: "synthetic-password",
      name: "Teacher",
    }),
  );
  expect(await response.json()).toEqual({ needsEmailConfirmation: true });
  expect(fixture.provision).not.toHaveBeenCalled();
});
it("rejects invalid passwords without provisioning an owner", async () => {
  fixture.signInWithPassword.mockResolvedValue({
    data: {},
    error: { status: 400 },
  });
  await expect(
    handleSupabaseAuth(
      request("sign-in/email", {
        email: "test@example.test",
        password: "wrong",
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(fixture.provision).not.toHaveBeenCalled();
});
it("closes a valid provider session when local binding fails", async () => {
  fixture.provision.mockRejectedValue(new Error("binding failed"));
  await expect(
    handleSupabaseAuth(
      request("sign-in/email", {
        email: "test@example.test",
        password: "synthetic-password",
      }),
    ),
  ).rejects.toThrow("binding failed");
  expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("enforces the shared login budget before calling the provider", async () => {
  fixture.query.mockResolvedValue({ rows: [{ count: 16 }] });
  await expect(
    handleSupabaseAuth(
      request("sign-in/email", {
        email: "test@example.test",
        password: "synthetic-password",
      }),
    ),
  ).rejects.toMatchObject({ status: 429 });
  expect(fixture.signInWithPassword).not.toHaveBeenCalled();
});
it("rejects cross-origin mutations and removes retired code endpoints", async () => {
  await expect(
    handleSupabaseAuth(request("sign-in/email", {}, "https://other.example")),
  ).rejects.toMatchObject({ code: "CSRF" });
  for (const path of ["send-code", "verify-code", "email-otp/verify-email"])
    expect((await handleSupabaseAuth(request(path))).status).toBe(404);
});
it("password reset requires fresh email recovery proof even for a logged-in owner", async () => {
  fixture.getUser.mockResolvedValue({
    data: { user: { id: "provider-user" } },
    error: null,
  });
  fixture.getSession.mockResolvedValue({
    data: { session: { access_token: token } },
    error: null,
  });
  fixture.read.mockResolvedValue({ id: "owner-a" });
  await expect(
    handleSupabaseAuth(
      request("reset-password", { newPassword: "synthetic-password" }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(fixture.updateUser).not.toHaveBeenCalled();
});
it("only verified confirmation callbacks can link imported accounts", async () => {
  fixture.verifyOtp.mockResolvedValue({
    data: {
      user: { id: "provider-user", user_metadata: { name: "Teacher" } },
      session: { access_token: token },
    },
    error: null,
  });
  const response = await handleSupabaseAuth(
    new Request(
      "https://school.example/api/auth/callback?token_hash=synthetic&type=signup&next=https://evil.example",
    ),
  );
  expect(fixture.provision).toHaveBeenCalledWith(
    expect.any(Object),
    sid,
    { name: "Teacher" },
    true,
  );
  expect(response.headers.get("location")).toBe("https://school.example/");
});
it("never trusts the cookie session when the provider rejects the user", async () => {
  fixture.getUser.mockResolvedValue({ data: {}, error: { status: 401 } });
  expect(await readSupabaseSession()).toBeNull();
  expect(fixture.getSession).not.toHaveBeenCalled();
  expect(fixture.read).not.toHaveBeenCalled();
});
it("denies a revoked local session despite a still valid provider token", async () => {
  fixture.getUser.mockResolvedValue({
    data: { user: { id: "provider-user" } },
    error: null,
  });
  fixture.getSession.mockResolvedValue({
    data: { session: { access_token: token } },
    error: null,
  });
  fixture.read.mockResolvedValue(null);
  expect(await readSupabaseSession()).toBeNull();
  expect(fixture.read).toHaveBeenCalledWith({ id: "provider-user" }, sid);
});
it("checks account intent before revoking other sessions", async () => {
  fixture.getUser.mockResolvedValue({
    data: { user: { id: "provider-user" } },
    error: null,
  });
  fixture.getSession.mockResolvedValue({
    data: { session: { access_token: token } },
    error: null,
  });
  fixture.read.mockResolvedValue({ id: "owner-a" });
  const req = request("revoke-other-sessions");
  req.headers.set("X-ZiyatAI-Account", "owner-b");
  await expect(handleSupabaseAuth(req)).rejects.toMatchObject({
    code: "SESSION_CHANGED",
  });
  expect(fixture.signOut).not.toHaveBeenCalled();
  expect(fixture.query).not.toHaveBeenCalled();
});
