import { authClient } from "../../lib/client";
import { type UiLocale } from "../../lib/i18n";
export type WorkspaceContentProps = {
  sessionState: ReturnType<typeof authClient.useSession>;
  authMode?: "login" | "signup";
  initialGuest?: boolean;
  initialLocale?: UiLocale;
};
export type View =
  | "plans"
  | "create"
  | "history"
  | "library"
  | "upload"
  | "review"
  | "editor"
  | "profile";
