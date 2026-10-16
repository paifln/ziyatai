import Workspace from "../../apps/web/components/Workspace";
import { cookies } from "next/headers";
export default async function LoginPage() {
  const locale =
    (await cookies()).get("ziyatai-locale")?.value === "ru" ? "ru" : "kk";
  return <Workspace authMode="login" initialLocale={locale} />;
}
