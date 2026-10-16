import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import "./globals.css";
import "./theme.css";
import "./landing.css";
import "./review.css";
import { browserSupportScript } from "../packages/domain/browser-support";
import { themeScript } from "../packages/domain/theme";
export const metadata: Metadata = {
  title: "ZiyatAI — оқу тапсырмалары",
  description:
    "Календарно-тематические планы и дифференцированные задания для учителей Казахстана",
  icons: { icon: "/favicon.png" },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const locale =
    requestCookies.get("ziyatai-locale")?.value === "ru" ? "ru" : "kk";
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
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
