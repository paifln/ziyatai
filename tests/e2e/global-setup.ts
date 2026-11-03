import { createConnection } from "node:net";
function antivirusReady() {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: 13310 });
    socket.setTimeout(1500);
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (data) => {
      const okay = data.toString().includes("PONG");
      socket.destroy();
      resolve(okay);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
export default async function setup() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const [app, renderer, av] = await Promise.all([
        fetch(
          (process.env.QA_BASE_URL || "http://localhost:3000") +
            "/api/health/ready",
        ).then((r) => r.ok),
        fetch("http://127.0.0.1:18090/health").then((r) => r.ok),
        antivirusReady(),
      ]);
      if (app && renderer && av) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Local web/worker/storage/renderer/antivirus are not ready");
}
