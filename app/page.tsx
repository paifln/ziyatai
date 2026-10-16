import Workspace from "../apps/web/components/Workspace";
import { cookies } from "next/headers";
export default async function Page() {
  const store = await cookies();
  const guest = !store
    .getAll()
    .some(({ name }) =>
      /^(?:__Secure-)?better-auth\.session_token$/.test(name),
    );
  const locale = store.get("ziyatai-locale")?.value === "ru" ? "ru" : "kk";
  return <Workspace initialGuest={guest} initialLocale={locale} />;
}
