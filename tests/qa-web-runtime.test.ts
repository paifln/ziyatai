import { expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  supervise,
  stopPhase,
  summarize,
  finishPhases,
} from "../scripts/qa-web-runtime.mjs";

async function directory() {
  const path = resolve(
    ".local",
    "qa-runtime-test-" + randomBytes(8).toString("hex"),
  );
  await mkdir(path, { recursive: true });
  return path;
}

it("retains a real child exit code without copying private logs or environment to the summary", async () => {
  const path = await directory();
  const environmentFile = resolve(path, "child.env");
  await writeFile(environmentFile, "QA_PRIVATE=synthetic-file-default\n");
  const result = await supervise("main", {
    directory: path,
    args: [
      `--env-file=${environmentFile}`,
      "-e",
      "console.log(process.env.QA_PRIVATE); process.exit(17)",
    ],
    environment: { NODE_ENV: "test", QA_PRIVATE: "synthetic-private-log" },
  });
  expect(result).toMatchObject({
    code: 17,
    signal: null,
    intentionalStop: false,
    forced: false,
  });
  const summary = await summarize(path);
  expect(summary[0]).toMatchObject({ code: 17, exitObserved: true });
  expect(JSON.stringify(summary)).not.toContain("synthetic-private-log");
  expect(JSON.stringify(summary)).not.toContain("QA_PRIVATE");
  expect(await readFile(resolve(path, "main.log"), "utf8")).toContain(
    "synthetic-private-log",
  );
  // Re-observing a completed run never signals an unrelated or reused PID.
  expect(await stopPhase("main", path)).toMatchObject({ code: 17 });
});

it("stops only its owned child and records the actual signal as a planned stop", async () => {
  const path = await directory();
  const running = supervise("main", {
    directory: path,
    args: ["-e", "setInterval(() => {}, 1000)"],
    environment: { NODE_ENV: "test" },
  });
  await expect
    .poll(async () => {
      try {
        return JSON.parse(
          await readFile(resolve(path, "main.start.json"), "utf8"),
        ).run;
      } catch {
        return undefined;
      }
    })
    .toBeTruthy();
  const stopped = await stopPhase("main", path);
  expect(stopped).toMatchObject({
    intentionalStop: true,
    stopReason: "control",
    forced: false,
  });
  expect(stopped?.signal).toBe("SIGTERM");
  expect(await running).toMatchObject({ signal: "SIGTERM" });
  expect((await summarize(path))[0]).toMatchObject({
    exitObserved: true,
    intentionalStop: true,
  });
});

it("ignores termination and stop records from an older generation", async () => {
  const path = await directory();
  const previous = await supervise("main", {
    directory: path,
    args: ["-e", "process.exit(5)"],
    environment: { NODE_ENV: "test" },
  });
  await writeFile(
    resolve(path, "main.stop.json"),
    JSON.stringify({ run: previous.run }),
  );
  const running = supervise("main", {
    directory: path,
    args: ["-e", "setInterval(() => {}, 1000)"],
    environment: { NODE_ENV: "test" },
  });
  await expect
    .poll(async () => {
      try {
        return (
          JSON.parse(await readFile(resolve(path, "main.start.json"), "utf8"))
            .run !== previous.run
        );
      } catch {
        return false;
      }
    })
    .toBe(true);
  expect((await summarize(path))[0]).toMatchObject({ exitObserved: false });
  const stopped = await stopPhase("main", path);
  expect(stopped).toMatchObject({ signal: "SIGTERM", intentionalStop: true });
  expect((await running).run).not.toBe(previous.run);
});

it("finishes the password-auth CI phase without requiring retired OTP servers", async () => {
  const path = await directory();
  const names = ["main"];
  const running = names.map((phase) =>
    supervise(phase, {
      directory: path,
      args: ["-e", "setInterval(() => {}, 1000)"],
      environment: { NODE_ENV: "test" },
    }),
  );
  await expect
    .poll(async () => {
      const started = await Promise.all(
        names.map(async (phase) => {
          try {
            return !!JSON.parse(
              await readFile(resolve(path, `${phase}.start.json`), "utf8"),
            ).run;
          } catch {
            return false;
          }
        }),
      );
      return started.every(Boolean);
    })
    .toBe(true);
  const finished = await finishPhases(path);
  await Promise.all(running);
  expect(finished.verified).toBe(true);
  expect(
    finished.phases.every(
      (phase) => phase.exitObserved && phase.intentionalStop,
    ),
  ).toBe(true);
  expect((await finishPhases(await directory())).verified).toBe(false);
});
