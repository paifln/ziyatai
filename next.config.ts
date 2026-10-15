import type { NextConfig } from "next";
const uploadEndpoint = process.env.UPLOAD_ORIGIN || process.env.STORAGE_PUBLIC_ENDPOINT || process.env.STORAGE_ENDPOINT;
const uploadOrigin = uploadEndpoint ? new URL(uploadEndpoint).origin : "";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "nodemailer"],
  async rewrites() {
    return [{ source: "/lite", destination: "/lite/index.html" }, { source: "/help", destination: "/help/index.html" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${uploadOrigin}; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
