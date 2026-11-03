import { env } from "./env";
import { scanClamStream } from "./clamav";

export async function documentDependenciesReady() {
  const e = env();
  if (e.APP_ENV === "local" && !e.RENDERER_URL && e.SCAN_REQUIRED !== "true")
    return;
  const checks: Promise<unknown>[] = [];
  if (e.RENDERER_URL)
    checks.push(
      fetch(`${e.RENDERER_URL}/health`, {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      }).then(async (response) => {
        void response.body?.cancel().catch(() => undefined);
        if (!response.ok) throw new Error("Renderer unavailable");
      }),
    );
  else if (e.APP_ENV === "production") throw new Error("Renderer missing");
  if (e.SCAN_REQUIRED === "true") {
    if (!e.CLAMAV_HOST) throw new Error("Antivirus endpoint missing");
    checks.push(
      scanClamStream(Buffer.alloc(0), {
        host: e.CLAMAV_HOST,
        port: e.CLAMAV_PORT,
        timeoutMs: 2000,
      }),
    );
  }
  await Promise.all(checks);
}
