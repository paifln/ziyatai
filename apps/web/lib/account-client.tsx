"use client";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createAccountClient } from "./client";

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
  const client = useMemo(
    () =>
      createAccountClient(owner, () => {
        void refresh.current();
      }),
    [owner],
  );
  return <Context.Provider value={client}>{children}</Context.Provider>;
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
