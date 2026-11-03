import { setTimeout } from "node:timers/promises";
import { scanClamStream } from "../../server/infrastructure/antivirus/clamav";

// Fixed loopback targets: this readiness probe cannot scan a hosted deployment.
const deadline = Date.now() + 240000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:18090/health", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Renderer not ready");
    await scanClamStream(Buffer.from("Synthetic CI readiness probe"), {
      host: "127.0.0.1",
      port: 13310,
      timeoutMs: 3000,
    });
    ready = true;
    break;
  } catch {
    await setTimeout(2000);
  }
}
if (!ready)
  throw new Error("Local renderer/antivirus readiness deadline exceeded");
console.log("Local renderer and antivirus are ready.");
