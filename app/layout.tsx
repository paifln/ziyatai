import publicAssets from "./public-assets.generated.json";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./theme.css";
import "./landing.css";
import "./review.css";
import { browserSupportScript } from "../packages/domain/browser-support";
import { themeScript } from "../packages/domain/theme";
import { requestLocale, siteOrigin } from "../apps/web/lib/site-metadata";
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: "ZiyatAI — оқу тапсырмалары",
  description:
    "Календарно-тематические планы и дифференцированные задания для учителей Казахстана",
  icons: { icon: "/favicon.png" },
  openGraph: {
    title: "ZiyatAI",
    siteName: "ZiyatAI",
    type: "website",
    images: [
      { url: "/social-card.png", width: 1200, height: 630, alt: "ZiyatAI" },
    ],
  },
  twitter: { card: "summary_large_image", images: ["/social-card.png"] },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const locale = await requestLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href={publicAssets.font}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: browserSupportScript }}
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <noscript>
          <div className="notice no-script">
            <h1>ZiyatAI</h1>
            <p>
              JavaScript қосыңыз / Включите JavaScript для работы с планами и
              заданиями.
            </p>
            <a href="/lite/">Жеңіл нұсқа / Лёгкая версия</a>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
