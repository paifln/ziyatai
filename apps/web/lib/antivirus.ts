import { createConnection } from "node:net";
import { env } from "./env";
import { AppError } from "../../../packages/domain/errors";
export async function scanStream(bytes: Buffer) {
  const e = env();
  return new Promise<void>((resolve, reject) => {
    let response = "";
    const socket = createConnection({
      host: e.CLAMAV_HOST,
      port: e.CLAMAV_PORT,
    });
    socket.setTimeout(60000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new AppError("SCAN_UNAVAILABLE", 503));
    });
    socket.on("error", () => reject(new AppError("SCAN_UNAVAILABLE", 503)));
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (response.length > 4000) {
        socket.destroy();
        reject(new AppError("SCAN_UNAVAILABLE", 503));
      }
    });
    socket.on("end", () => {
      if (/\bFOUND\b/.test(response)) reject(new AppError("FILE_UNSAFE", 422));
      else if (/:\s*OK(?:\0|\n|$)/.test(response)) resolve();
      else reject(new AppError("SCAN_UNAVAILABLE", 503));
    });
  });
}
