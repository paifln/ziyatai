import { env } from "./env";
import { scanClamStream } from "./clamav";

export async function scanStream(bytes: Buffer) {
  const e = env();
  await scanClamStream(bytes, { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT });
}
