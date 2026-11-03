"use client";
import { authClient } from "../lib/client";
import { AccountClientProvider } from "../lib/account-client";
import { type UiLocale } from "../lib/i18n";
import { ConfirmProvider } from "./ui/ConfirmProvider";
import { WorkspaceContent } from "../features/workspace/WorkspaceContent";
export default function Workspace({
  authMode,
  initialGuest,
  initialLocale,
}: {
  authMode?: "login" | "signup";
  initialGuest?: boolean;
  initialLocale?: UiLocale;
}) {
  const sessionState = authClient.useSession();
  return (
    <AccountClientProvider
      key={sessionState.data?.user.id ?? "guest"}
      owner={sessionState.data?.user.id}
      onSessionChanged={sessionState.refetch}
    >
      <ConfirmProvider>
        <WorkspaceContent
          sessionState={sessionState}
          authMode={authMode}
          initialGuest={initialGuest}
          initialLocale={initialLocale}
        />
      </ConfirmProvider>
    </AccountClientProvider>
  );
}
