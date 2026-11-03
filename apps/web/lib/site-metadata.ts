import { siteCopy } from "../../../packages/domain/site-copy";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
export const siteOrigin = new URL(
  process.env.PUBLIC_SITE_URL || "https://ziyatai.netlify.app",
).origin;
export async function requestLocale() {
  const [head, store] = await Promise.all([headers(), cookies()]);
  return (head.get("x-ziyatai-locale") ||
    store.get("ziyatai-locale")?.value) === "ru"
    ? "ru"
    : "kk";
}
const copy = siteCopy;
export async function pageMetadata(
  kind: "home" | "login" | "signup",
  privatePage = false,
): Promise<Metadata> {
  const locale = await requestLocale();
  const t = copy[locale];
  const path = kind === "home" ? `/?lang=${locale}` : `/${kind}`;
  return {
    metadataBase: new URL(siteOrigin),
    title: t[kind],
    description: t.description,
    alternates: {
      canonical: path,
      ...(kind === "home" && !privatePage
        ? { languages: { kk: "/?lang=kk", ru: "/?lang=ru", "x-default": "/" } }
        : {}),
    },
    robots: { index: kind === "home" && !privatePage, follow: true },
    openGraph: {
      title: t[kind],
      description: t.description,
      url: path,
      siteName: "ZiyatAI",
      type: "website",
      locale: locale === "ru" ? "ru_KZ" : "kk_KZ",
      images: [
        { url: "/social-card.png", width: 1200, height: 630, alt: "ZiyatAI" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t[kind],
      description: t.description,
      images: ["/social-card.png"],
    },
  };
}
