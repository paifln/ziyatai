import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./packages/domain/content-security-policy";
const uploadEndpoint =
  process.env.UPLOAD_ORIGIN ||
  process.env.STORAGE_PUBLIC_ENDPOINT ||
  process.env.STORAGE_ENDPOINT;
const uploadOrigin = uploadEndpoint ? new URL(uploadEndpoint).origin : "";
const config: NextConfig = {
  // Public origin only; this makes the proxy's policy reproducible on Netlify too.
  env: {
    ZIYATAI_UPLOAD_ORIGIN: uploadOrigin,
    LEGAL_OPERATOR_NAME: process.env.LEGAL_OPERATOR_NAME || "",
    LEGAL_CONTACT_EMAIL: process.env.LEGAL_CONTACT_EMAIL || "",
  },
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["pg"],
  async rewrites() {
    return [
      { source: "/lite", destination: "/lite/index.html" },
      { source: "/help", destination: "/help/index.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy({
              uploadOrigin,
              development: process.env.NODE_ENV === "development",
            }),
          },
        ],
      },
    ];
  },
};
export default config;
