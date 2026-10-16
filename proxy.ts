import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./packages/domain/content-security-policy";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
  const csp = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    uploadOrigin: process.env.ZIYATAI_UPLOAD_ORIGIN,
  });
  const headers = new Headers(request.headers);
  // Never trust a nonce or CSP supplied by a client or upstream proxy.
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!api|_next|lite|help|fonts|brand-owl|favicon|licenses).*)"],
};
