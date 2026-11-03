import { expect, it } from "vitest";
import {
  sessionReadKey,
  sessionReadPath,
} from "../server/http/session-read-budget";

const options = {
  advanced: { ipAddress: { ipAddressHeaders: ["x-ziyatai-client-ip"] } },
};
const secret = "synthetic-session-budget-secret-for-unit-tests";
function request(ip: string, extra: Record<string, string> = {}) {
  return new Request("https://school.example.test/api/auth/get-session", {
    headers: { "x-ziyatai-client-ip": ip, ...extra },
  });
}
it("covers canonical session paths and encoded/trailing variants without admitting sibling actions", () => {
  const base = "https://school.example.test/api/auth";
  for (const path of [
    "get-session",
    "get-session/",
    "get-session///?read=1",
    "%67et-session",
    "get%2Dsession",
  ])
    expect(
      sessionReadPath(`https://api.example.test/api/auth/${path}`, base),
    ).toBe(true);
  for (const path of [
    "sign-in/email",
    "get-session/extra",
    "get-session-other",
    "%zz",
    "../get-session",
  ])
    expect(
      sessionReadPath(`https://api.example.test/api/auth/${path}`, base),
    ).toBe(false);
});
it("uses the configured trusted IP source and ignores cookies, query keys and spoofed alternative headers", () => {
  const first = sessionReadKey(request("192.0.2.1"), options, secret);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(
    sessionReadKey(
      request("192.0.2.1", {
        "x-forwarded-for": "198.51.100.99",
        cookie: "synthetic=another",
      }),
      options,
      secret,
    ),
  ).toBe(first);
  expect(sessionReadKey(request("192.0.2.2"), options, secret)).not.toBe(first);
  expect(
    sessionReadKey(request("192.0.2.1"), options, secret + "-rotation"),
  ).not.toBe(first);
});
it("preserves the SDK's IPv4 mapping and IPv6 network grouping", () => {
  expect(sessionReadKey(request("::ffff:192.0.2.1"), options, secret)).toBe(
    sessionReadKey(request("192.0.2.1"), options, secret),
  );
  expect(
    sessionReadKey(request("2001:db8:1234:5678::1"), options, secret),
  ).toBe(sessionReadKey(request("2001:0db8:1234:5678::ff"), options, secret));
  expect(
    sessionReadKey(request("2001:db8:1234:5679::1"), options, secret),
  ).not.toBe(sessionReadKey(request("2001:db8:1234:5678::1"), options, secret));
});
