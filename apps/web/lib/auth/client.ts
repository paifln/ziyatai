"use client";
import { useEffect, useSyncExternalStore } from "react";

type Session = {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    emailVerified: boolean;
  };
  session: { id: string; userId: string; expiresAt: string };
};
type Result = {
  data: { success?: boolean; needsEmailConfirmation?: boolean } | null;
  error: { code: string; status: number } | null;
};
type Options = {
  fetchOptions?: { headers?: Record<string, string>; signal?: AbortSignal };
};
const initial = {
  data: null as Session | null,
  isPending: true,
  error: null as (Error & { status?: number }) | null,
};
let snapshot = initial;
let revision = 0;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
function publish(value: typeof initial) {
  snapshot = value;
  for (const listener of listeners) listener();
}
async function refetch() {
  if (pending) return pending;
  const generation = revision;
  pending = (async () => {
    try {
      const response = await fetch("/api/auth/get-session", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw Object.assign(new Error("Session unavailable"), {
          status: response.status,
        });
      const data: Session | null = await response.json();
      if (generation === revision)
        publish({ data, isPending: false, error: null });
    } catch (error) {
      if (generation === revision)
        publish({
          ...snapshot,
          isPending: false,
          error:
            error instanceof Error ? error : new Error("Session unavailable"),
        });
    }
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
function invalidate() {
  revision++;
  publish({ ...snapshot, isPending: true });
  void (pending ?? Promise.resolve()).then(refetch);
}
async function command(
  path: string,
  input: Options & Record<string, unknown> = {},
): Promise<Result> {
  const { fetchOptions, ...body } = input;
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...fetchOptions?.headers },
    body: JSON.stringify(body),
    signal: fetchOptions?.signal ?? AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok)
    return {
      data: null,
      error: {
        code: value.code ?? "AUTH_UNAVAILABLE",
        status: response.status,
      },
    };
  invalidate();
  try {
    localStorage.setItem(
      "ziyatai.auth",
      JSON.stringify({ revision: crypto.randomUUID() }),
    );
  } catch {
    /* Storage can be disabled. */
  }
  return { data: value, error: null };
}
export const authClient = {
  signIn: {
    email: (input: { email: string; password: string }) =>
      command("sign-in/email", input),
  },
  signUp: {
    email: (input: {
      email: string;
      password: string;
      name: string;
      teachingSubject?: string;
    }) => command("sign-up/email", input),
  },
  signOut: (input?: Options) => command("sign-out", input),
  revokeOtherSessions: (input?: Options) =>
    command("revoke-other-sessions", input),
  changePassword: (
    input: Options & {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    },
  ) => command("change-password", input),
  requestPasswordReset: (input: { email: string }) =>
    command("request-password-reset", input),
  resetPassword: (input: { newPassword: string }) =>
    command("reset-password", input),
  getSession: async () => {
    await refetch();
    return { data: snapshot.data, error: snapshot.error };
  },
  useSession() {
    const state = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      () => snapshot,
      () => initial,
    );
    useEffect(() => {
      void refetch();
      const refresh = () => {
        if (document.visibilityState === "visible") invalidate();
      };
      const storage = (event: StorageEvent) => {
        if (event.key === "ziyatai.auth") invalidate();
      };
      window.addEventListener("focus", refresh);
      window.addEventListener("online", refresh);
      window.addEventListener("pageshow", refresh);
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("storage", storage);
      return () => {
        window.removeEventListener("focus", refresh);
        window.removeEventListener("online", refresh);
        window.removeEventListener("pageshow", refresh);
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("storage", storage);
      };
    }, []);
    return { ...state, refetch };
  },
};
