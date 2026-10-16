import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { browserSupportScript } from "../packages/domain/browser-support";
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="kk">
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: browserSupportScript }}
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
