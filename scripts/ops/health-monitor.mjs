// Read-only probe; safe for an external scheduler. No response bodies or secrets.
const base = new URL(
  process.env.MONITOR_ORIGIN || "https://ziyatai.netlify.app",
);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.pathname !== "/"
)
  throw new Error("MONITOR_ORIGIN must be an HTTPS origin");
let healthy = false;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const response = await fetch(new URL("/api/health/ready", base), {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    healthy = response.ok;
    await response.body?.cancel();
    if (healthy) break;
  } catch {
    /* Report only fixed, non-sensitive status. */
  }
}
console.log(
  JSON.stringify({
    event: "external_readiness",
    status: healthy ? "ok" : "failed",
  }),
);
if (!healthy) process.exitCode = 1;
