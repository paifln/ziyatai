// k6: read-only authenticated metadata load, no registration, AI or file writes.
import http from "k6/http";
import { check, sleep } from "k6";
export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};
export default function () {
  const base = __ENV.STAGING_ORIGIN;
  if (!base || !/^https:\/\//.test(base) || !__ENV.SESSION_COOKIE)
    throw new Error("Set STAGING_ORIGIN and a synthetic SESSION_COOKIE");
  if (
    base.includes("ziyatai.netlify.app") ||
    base.includes("api-production-3a1f7")
  )
    throw new Error("This harness is restricted to staging");
  const response = http.get(`${base}/api/ktp/collection?limit=20`, {
    headers: { Cookie: __ENV.SESSION_COOKIE },
    tags: { name: "plan_collection" },
    timeout: "15s",
  });
  check(response, { "metadata succeeds": (value) => value.status === 200 });
  sleep(1);
}
