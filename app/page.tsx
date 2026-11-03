import Workspace from "../apps/web/components/Workspace";
import { cookies } from "next/headers";
import { pageMetadata, requestLocale } from "../apps/web/lib/site-metadata";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, store] = await Promise.all([searchParams, cookies()]);
  const privatePage =
    !!(params.view || params.plan || params.generation) ||
    store.getAll().some(({ name }) => /^ziyatai-auth(?:\.\d+)?$/.test(name));
  return pageMetadata("home", privatePage);
}
export default async function Page() {
  const store = await cookies();
  const guest = !store
    .getAll()
    .some(({ name }) => /^ziyatai-auth(?:\.\d+)?$/.test(name));
  const locale = await requestLocale();
  return <Workspace initialGuest={guest} initialLocale={locale} />;
}
