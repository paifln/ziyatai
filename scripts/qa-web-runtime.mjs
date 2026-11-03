import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const phases = ["main"];
const defaultDirectory = resolve(".local/qa-runtime");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function paths(phase, directory) {
  if (!phases.includes(phase)) throw new Error("Unknown QA web phase");
  return {
    start: join(directory, `${phase}.start.json`),
    exit: join(directory, `${phase}.exit.json`),
    stop: join(directory, `${phase}.stop.json`),
    log: join(directory, `${phase}.log`),
  };
}
async function json(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
async function save(path, value) {
  await writeFile(path, JSON.stringify(value) + "\n");
}

/** CI-only observer: owns one child, records termination, never restarts it. */
export async function supervise(
  phase,
  {
    directory = defaultDirectory,
    args = ["--env-file=.env.local", "scripts/start-web.mjs"],
    environment = process.env,
  } = {},
) {
  const files = paths(phase, directory);
  await mkdir(directory, { recursive: true });
  const log = await open(files.log, "w");
  const child = spawn(process.execPath, args, {
    env: environment,
    windowsHide: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  const metadata = {
    phase,
    run: randomUUID(),
    startedAt: new Date().toISOString(),
    pid: child.pid ?? null,
    node: process.version,
  };
  // Install termination listeners before awaiting filesystem I/O: a child may exit immediately.
  const started = save(files.start, metadata);
  return new Promise((done, reject) => {
    let settled = false,
      stopping = false,
      stopReason = null,
      forced = false;
    let forceTimer;
    const stop = (reason) => {
      if (stopping || settled) return;
      stopping = true;
      stopReason = reason;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            forced = true;
            child.kill("SIGKILL");
          }
        }, 25000);
      }
    };
    const parentSignal = () => stop("supervisor-signal");
    process.on("SIGTERM", parentSignal);
    process.on("SIGINT", parentSignal);
    const polling = setInterval(async () => {
      const command = await json(files.stop);
      if (command?.run === metadata.run) stop("control");
    }, 100);
    const finished = async (code, signal, spawnErrorCode = null) => {
      if (settled) return;
      settled = true;
      clearInterval(polling);
      clearTimeout(forceTimer);
      process.off("SIGTERM", parentSignal);
      process.off("SIGINT", parentSignal);
      const result = {
        ...metadata,
        endedAt: new Date().toISOString(),
        code,
        signal,
        intentionalStop: stopReason === "control",
        stopReason,
        forced,
        spawnErrorCode,
      };
      try {
        await started;
        await log.close();
        await save(files.exit, result);
        done(result);
      } catch {
        await log.close().catch(() => undefined);
        reject(new Error("QA termination metadata could not be saved"));
      }
    };
    child.once("exit", (code, signal) => {
      void finished(code, signal);
    });
    child.once("error", (error) => {
      void finished(
        null,
        null,
        /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "SPAWN_FAILED",
      );
    });
    void started.catch(() => stop("metadata-error"));
  });
}

/** A matching control file lets the supervisor stop its child, never a PID read from a stale file. */
export async function stopPhase(phase, directory = defaultDirectory) {
  const files = paths(phase, directory);
  const started = await json(files.start);
  if (!started) return null;
  let ended = await json(files.exit);
  if (ended?.run === started.run) return ended;
  await save(files.stop, { run: started.run });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    ended = await json(files.exit);
    if (ended?.run === started.run) return ended;
    await delay(100);
  }
  throw new Error("QA child termination was not observed");
}

/** Only process metadata is public; logs, arguments and environment remain private. */
export async function summarize(directory = defaultDirectory) {
  return Promise.all(
    phases.map(async (phase) => {
      const files = paths(phase, directory);
      const started = await json(files.start),
        ended = await json(files.exit);
      return ended?.run && ended.run === started?.run
        ? { ...ended, exitObserved: true }
        : { phase, startedAt: started?.startedAt ?? null, exitObserved: false };
    }),
  );
}

export async function finishPhases(directory = defaultDirectory) {
  let controlFailed = false;
  for (const phase of phases) {
    try {
      await stopPhase(phase, directory);
    } catch {
      controlFailed = true;
    }
  }
  const summary = await summarize(directory);
  return {
    phases: summary,
    verified:
      !controlFailed &&
      summary.every(
        (item) =>
          item.exitObserved &&
          item.intentionalStop &&
          !item.forced &&
          !item.spawnErrorCode,
      ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [action, phase] = process.argv.slice(2);
  try {
    if (action === "start") {
      const result = await supervise(phase);
      console.log(JSON.stringify({ event: "qa-web-exit", ...result }));
      if (!result.intentionalStop || result.forced || result.spawnErrorCode)
        process.exitCode = 1;
    } else if (action === "stop") {
      await stopPhase(phase);
    } else if (action === "finish") {
      const summary = await finishPhases();
      console.log(JSON.stringify({ event: "qa-web-summary", ...summary }));
      if (!summary.verified) process.exitCode = 1;
    } else throw new Error("Use start PHASE, stop PHASE, or finish");
  } catch {
    console.error(
      JSON.stringify({
        event: "qa-web-control-failed",
        action: ["start", "stop", "finish"].includes(action)
          ? action
          : "invalid",
        phase: phases.includes(phase) ? phase : null,
      }),
    );
    process.exitCode = 1;
  }
}
