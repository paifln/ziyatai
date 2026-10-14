import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ZiyatAI — оқу тапсырмалары",
  description:
    "Календарно-тематические планы и дифференцированные задания для учителей информатики Казахстана",
  icons: { icon: "/owl.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="kk">
      <body>{children}</body>
    </html>
  );
}
