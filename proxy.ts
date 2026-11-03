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
  const explicitLocale = request.nextUrl.searchParams.get("lang");
  const locale =
    explicitLocale === "ru" || explicitLocale === "kk"
      ? explicitLocale
      : request.cookies.get("ziyatai-locale")?.value === "ru"
        ? "ru"
        : "kk";
  headers.set("x-ziyatai-locale", locale);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  if (explicitLocale === "ru" || explicitLocale === "kk")
    response.cookies.set("ziyatai-locale", locale, {
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 31536000,
    });
  return response;
}
export const config = {
  matcher: ["/((?!api|_next|assets|lite|help|fonts|brand-owl|favicon|licenses).*)"],
};
