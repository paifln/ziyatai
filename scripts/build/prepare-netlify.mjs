import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function secureOrigin(value, name) {
  if (!value) throw new Error(`${name} must be configured before deploying`);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} must be an HTTPS origin without credentials, path or query`,
    );
  return url.origin;
}

export function createNetlifyRouting(api, upload) {
  const apiOrigin = secureOrigin(api, "ZIYATAI_API_ORIGIN");
  const uploadOrigin = secureOrigin(upload, "UPLOAD_ORIGIN");
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${uploadOrigin}; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
  return {
    apiRedirect: {
      from: "/api/*",
      to: `${apiOrigin}/api/:splat`,
      status: 200,
      force: true,
      signed: "NETLIFY_PROXY_SECRET",
    },
    redirects: `/lite /lite/index.html 200\n/lite/ /lite/index.html 200\n/help /help/index.html 200\n/help/ /help/index.html 200\n`,
    headers: `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Cross-Origin-Resource-Policy: same-origin\n  Cross-Origin-Opener-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: ${csp}\n/lite/*\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = createNetlifyRouting(
    process.env.ZIYATAI_API_ORIGIN,
    process.env.UPLOAD_ORIGIN,
  );
  await writeFile("public/_redirects", files.redirects);
  await writeFile("public/_headers", files.headers);
  console.log(
    "Netlify routing prepared. Private API secrets are not required by the frontend build.",
  );
}
