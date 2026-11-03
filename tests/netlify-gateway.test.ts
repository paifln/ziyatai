import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { verifyNetlifyRequest } from "../server/http/netlify-gateway";
const secret = "synthetic-proxy-key-".repeat(3),
  siteId = "b0f3e39e-36bd-4d5e-bd5f-6c938fdc81bc",
  now = 1900000000;
const options = { secret, siteId, production: true, now };
function signed(
  claims: Record<string, unknown> = {},
  key = secret,
  algorithm = "HS256",
) {
  const first = Buffer.from(
    JSON.stringify({ alg: algorithm, typ: "JWT" }),
  ).toString("base64url");
  const second = Buffer.from(
    JSON.stringify({
      iss: "netlify",
      netlify_id: siteId,
      exp: now + 60,
      deploy_context: "production",
      ...claims,
    }),
  ).toString("base64url");
  return (
    first +
    "." +
    second +
    "." +
    createHmac("sha256", key)
      .update(first + "." + second)
      .digest("base64url")
  );
}
function request(token = signed(), ip = "192.0.2.42") {
  return new Request("https://api.example.test/api/profile", {
    method: "POST",
    headers: {
      "x-nf-sign": token,
      "x-nf-client-connection-ip": ip,
      "x-ziyatai-client-ip": "203.0.113.99",
      Origin: "https://school.example.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ test: true }),
  });
}
it("preserves body and origin, replaces the untrusted IP after verification", async () => {
  const result = verifyNetlifyRequest(request(), options);
  expect(result.headers.get("x-ziyatai-client-ip")).toBe("192.0.2.42");
  expect(result.headers.get("origin")).toBe("https://school.example.test");
  expect(await result.json()).toEqual({ test: true });
});
it.each([
  ["missing", ""],
  ["malformed", "a.b.c"],
  ["wrong key", signed({}, "wrong-key")],
  ["algorithm confusion", signed({}, secret, "none")],
  ["expired", signed({ exp: now })],
  ["missing expiry", signed({ exp: undefined })],
  ["wrong issuer", signed({ iss: "other" })],
  ["wrong site", signed({ netlify_id: "other" })],
  ["preview on production", signed({ deploy_context: "deploy-preview" })],
  ["not yet valid", signed({ nbf: now + 120 })],
  ["oversized", "a".repeat(9000)],
])("rejects %s", (_, token) =>
  expect(() => verifyNetlifyRequest(request(token), options)).toThrowError(
    "CSRF",
  ),
);
it.each(["", "192.0.2.1, 192.0.2.2", "192.0.2.1:1234", "not-an-ip"])(
  "rejects an invalid provider IP: %s",
  (ip) =>
    expect(() =>
      verifyNetlifyRequest(request(signed(), ip), options),
    ).toThrowError("CSRF"),
);
it("accepts a signed IPv6 client address", () =>
  expect(
    verifyNetlifyRequest(request(signed(), "2001:db8::1"), options).headers.get(
      "x-ziyatai-client-ip",
    ),
  ).toBe("2001:db8::1"));
