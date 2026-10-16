export function contentSecurityPolicy({
  nonce,
  uploadOrigin = "",
  development = false,
}: {
  nonce?: string;
  uploadOrigin?: string;
  development?: boolean;
}) {
  if (nonce && !/^[A-Za-z0-9+/]{24,}={0,2}$/.test(nonce))
    throw new Error("Invalid CSP nonce");
  const origin = uploadOrigin ? new URL(uploadOrigin).origin : "";
  if (origin && !/^https?:\/\//.test(origin))
    throw new Error("Upload origin must use HTTP or HTTPS");
  const scripts = nonce ? `'self' 'nonce-${nonce}' 'strict-dynamic'` : "'self'";
  return `default-src 'self'; script-src ${scripts}${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${origin}; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}
