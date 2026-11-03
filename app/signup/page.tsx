import Workspace from "../../apps/web/components/Workspace";
import { pageMetadata, requestLocale } from "../../apps/web/lib/site-metadata";
export const generateMetadata = () => pageMetadata("signup");
export default async function SignupPage() {
  const locale = await requestLocale();
  return <Workspace authMode="signup" initialLocale={locale} />;
}
