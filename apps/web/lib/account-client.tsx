"use client";
import {
  createContext,
  useContext,
  useMemo,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { createAccountClient } from "./client";
import { createRequestLifetime } from "./request-lifetime";

const Context = createContext<ReturnType<typeof createAccountClient> | null>(
  null,
);

export function AccountClientProvider({
  owner,
  onSessionChanged,
  children,
}: {
  owner?: string;
  onSessionChanged: () => unknown;
  children: ReactNode;
}) {
  const refresh = useRef(onSessionChanged);
  refresh.current = onSessionChanged;
  const scoped = useMemo(() => {
    const lifetime = createRequestLifetime();
    const client = createAccountClient(
      owner,
      () => {
        void refresh.current();
      },
      () => lifetime.signal,
    );
    return { client, lifetime };
  }, [owner]);
  useLayoutEffect(() => {
    scoped.lifetime.activate();
    return () => scoped.lifetime.stop();
  }, [scoped]);
  return <Context.Provider value={scoped.client}>{children}</Context.Provider>;
}

export function useAccountClient() {
  const client = useContext(Context);
  if (!client)
    throw new Error("Account client requires its workspace provider");
  return client;
}

export function useAccountApi() {
  return useAccountClient().api;
}
