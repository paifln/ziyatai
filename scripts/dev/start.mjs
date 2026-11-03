import { spawn } from "node:child_process";

// The parent loads .env.local with Node. A clean child argument list prevents
// --env-file from leaking into Next's NODE_OPTIONS; literal $ values stay intact.
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    ...process.argv.slice(2),
  ],
  { env: process.env, stdio: "inherit", windowsHide: true },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("Next.js could not start.");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
