import { createConnection } from "node:net";
import { AppError } from "../../../packages/domain/errors";

/** One bounded INSTREAM exchange. Only an exact completed clean reply admits a file. */
export function scanClamStream(
  bytes: Buffer,
  endpoint: { host: string; port: number; timeoutMs?: number },
) {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection({
      host: endpoint.host,
      port: endpoint.port,
    });
    let response = "";
    let settled = false;
    let uploaded = false;
    const finish = (code?: "FILE_UNSAFE" | "SCAN_UNAVAILABLE") => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (code) reject(new AppError(code, code === "FILE_UNSAFE" ? 422 : 503));
      else resolve();
    };
    // An inactivity timeout alone lets a trickling peer hold the upload forever.
    const deadline = setTimeout(
      () => finish("SCAN_UNAVAILABLE"),
      Math.min(Math.max(endpoint.timeoutMs ?? 60000, 1), 60000),
    );
    deadline.unref();
    const write = (chunk: Buffer | string) =>
      new Promise<void>((done, fail) => {
        socket.write(chunk, (error) => (error ? fail(error) : done()));
      });
    socket.once("connect", () => {
      void (async () => {
        await write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          if (settled) return;
          const chunk = bytes.subarray(offset, offset + 32768);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          await write(size);
          await write(chunk);
        }
        await write(Buffer.alloc(4));
        uploaded = true;
      })().catch(() => finish("SCAN_UNAVAILABLE"));
    });
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (chunk.length + response.length > 4000) {
        finish("SCAN_UNAVAILABLE");
        return;
      }
      response += chunk.toString("latin1");
    });
    socket.once("end", () => {
      if (/^stream: [^\0\r\n]+ FOUND\0$/.test(response)) finish("FILE_UNSAFE");
      else if (uploaded && response === "stream: OK\0") finish();
      else finish("SCAN_UNAVAILABLE");
    });
    socket.once("error", () => finish("SCAN_UNAVAILABLE"));
    socket.once("close", () => finish("SCAN_UNAVAILABLE"));
  });
}
