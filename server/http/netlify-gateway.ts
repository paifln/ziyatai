import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { AppError } from "../../packages/domain/errors";
import { env } from "../config/env";

/** Verify Netlify's HS256 signed proxy claim before trusting its client IP. */
export function verifyNetlifyRequest(
  req: Request,
  options: {
    secret: string;
    siteId: string;
    production: boolean;
    now?: number;
  },
) {
  try {
    const token = req.headers.get("x-nf-sign") || "";
    if (token.length > 8192) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
      throw new Error();
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    if (header.alg !== "HS256" || header.crit) throw new Error();
    const signature = Buffer.from(parts[2], "base64url");
    const expected = createHmac("sha256", options.secret)
      .update(parts[0] + "." + parts[1])
      .digest();
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      throw new Error();
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (
      claims.iss !== "netlify" ||
      claims.netlify_id !== options.siteId ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= now ||
      (claims.nbf !== undefined &&
        (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 30))
    )
      throw new Error();
    if (options.production && claims.deploy_context !== "production")
      throw new Error();
    const ip = req.headers.get("x-nf-client-connection-ip") || "";
    if (!isIP(ip)) throw new Error();
    const headers = new Headers(req.headers);
    headers.set("x-ziyatai-client-ip", ip);
    return new Request(req, { headers });
  } catch {
    throw new AppError("CSRF", 403);
  }
}

export function trustedGatewayRequest(req: Request) {
  const e = env();
  return e.API_GATEWAY === "netlify"
    ? verifyNetlifyRequest(req, {
        secret: e.NETLIFY_PROXY_SECRET,
        siteId: e.NETLIFY_SITE_ID,
        production: e.APP_ENV === "production",
      })
    : (() => {
        const headers = new Headers(req.headers);
        headers.delete("x-ziyatai-client-ip");
        return new Request(req, { headers });
      })();
}
