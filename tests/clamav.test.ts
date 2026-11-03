import { createServer, type AddressInfo, type Socket } from "node:net";
import { expect, it } from "vitest";
import { scanClamStream } from "../apps/web/lib/clamav";

async function withScanner(
  handle: (socket: Socket) => void,
  check: (endpoint: { host: string; port: number }) => Promise<void>,
) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    handle(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await check({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function receiveUpload(socket: Socket, complete: (bytes: Buffer) => void) {
  let pending = Buffer.alloc(0);
  let command = false;
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    if (!command) {
      if (pending.length < 10) return;
      expect(pending.subarray(0, 10).toString()).toBe("zINSTREAM\0");
      pending = pending.subarray(10);
      command = true;
    }
    while (pending.length >= 4) {
      const size = pending.readUInt32BE(0);
      expect(size).toBeLessThanOrEqual(32768);
      if (pending.length < size + 4) return;
      chunks.push(pending.subarray(4, size + 4));
      pending = pending.subarray(size + 4);
      if (size === 0) {
        complete(Buffer.concat(chunks));
        return;
      }
    }
  });
}

it("sends every byte in bounded INSTREAM frames and accepts only a completed clean reply", async () => {
  const bytes = Buffer.alloc(1024 * 1024 + 17, 123);
  await withScanner(
    (socket) =>
      receiveUpload(socket, (received) => {
        expect(received).toEqual(bytes);
        socket.write("stream: O");
        socket.end("K\0");
      }),
    async (endpoint) => {
      await expect(scanClamStream(bytes, endpoint)).resolves.toBeUndefined();
    },
  );
});

it("rejects a detected signature without exposing its name", async () => {
  await withScanner(
    (socket) =>
      receiveUpload(socket, () => socket.end("stream: private-name FOUND\0")),
    async (endpoint) => {
      await expect(
        scanClamStream(Buffer.from("fixture"), endpoint),
      ).rejects.toMatchObject({ code: "FILE_UNSAFE", status: 422 });
    },
  );
});

it.each([
  "",
  "stream: OK",
  "stream: OK\n",
  "untrusted: OK\0",
  "stream: ERROR\nstream: OK\0",
  "stream: OK\0trailing-data",
  "stream: size limit exceeded ERROR\0",
  "x".repeat(4001),
])(
  "fails closed for incomplete or malformed scanner reply %j",
  async (reply) => {
    await withScanner(
      (socket) => receiveUpload(socket, () => socket.end(reply)),
      async (endpoint) => {
        await expect(
          scanClamStream(Buffer.from("fixture"), endpoint),
        ).rejects.toMatchObject({ code: "SCAN_UNAVAILABLE", status: 503 });
      },
    );
  },
);

it("bounds the entire exchange even when the scanner keeps sending data", async () => {
  await withScanner(
    (socket) =>
      receiveUpload(socket, () => {
        const trickle = setInterval(() => socket.write("x"), 10);
        socket.once("close", () => clearInterval(trickle));
      }),
    async (endpoint) => {
      await expect(
        scanClamStream(Buffer.from("fixture"), { ...endpoint, timeoutMs: 120 }),
      ).rejects.toMatchObject({ code: "SCAN_UNAVAILABLE", status: 503 });
    },
  );
});

it("stops writing to an unresponsive scanner at the overall deadline", async () => {
  await withScanner(
    (socket) => socket.pause(),
    async (endpoint) => {
      await expect(
        scanClamStream(Buffer.alloc(16 * 1024 * 1024), {
          ...endpoint,
          timeoutMs: 120,
        }),
      ).rejects.toMatchObject({ code: "SCAN_UNAVAILABLE", status: 503 });
    },
  );
});

it("fails closed when the scanner resets the connection during upload", async () => {
  await withScanner(
    (socket) => socket.destroy(),
    async (endpoint) => {
      await expect(
        scanClamStream(Buffer.alloc(1024 * 1024), endpoint),
      ).rejects.toMatchObject({ code: "SCAN_UNAVAILABLE", status: 503 });
    },
  );
});
