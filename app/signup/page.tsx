import Workspace from "../../apps/web/components/Workspace";
import { cookies } from "next/headers";
export default async function SignupPage() {
  const locale =
    (await cookies()).get("ziyatai-locale")?.value === "ru" ? "ru" : "kk";
  return <Workspace authMode="signup" initialLocale={locale} />;
}
