import Workspace from "../../apps/web/components/Workspace";
import { pageMetadata, requestLocale } from "../../apps/web/lib/site-metadata";
export const generateMetadata = () => pageMetadata("login");
export default async function LoginPage() {
  const locale = await requestLocale();
  return <Workspace authMode="login" initialLocale={locale} />;
}
