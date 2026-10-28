import { request, type APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { accountIntentHeader } from "../packages/contracts/account-intent";

const baseURL = "http://localhost:3000";
const container = "ziyatai-runtime-web-1";
const seconds = Number(
  process.argv.find((arg) => arg.startsWith("--seconds="))?.slice(10) ?? 600,
);
if (!Number.isInteger(seconds) || seconds < 15 || seconds > 1800)
  throw new Error("Use --seconds=15..1800 for the owned local runtime");
const run = randomBytes(8).toString("hex");
const network = `198.19.${randomInt(0, 256)}.${randomInt(1, 255)}`;
const exec = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class CheckFailure extends Error {}
function requireCheck(value: unknown, code: string): asserts value {
  if (!value) throw new CheckFailure(code);
}
async function state() {
  try {
    const { stdout } = await exec(
      "docker",
      [
        "inspect",
        "--format",
        "{{.Id}} {{.Image}} {{.RestartCount}} {{.State.StartedAt}} {{.State.Status}}",
        container,
      ],
      { windowsHide: true, timeout: 5000 },
    );
    const [id, image, restarts, startedAt, status] = stdout.trim().split(/\s+/);
    requireCheck(
      id && image && startedAt && status && Number.isInteger(Number(restarts)),
      "runtime_state_invalid",
    );
    return { id, image, restarts: Number(restarts), startedAt, status };
  } catch {
    throw new CheckFailure("runtime_observation_failed");
  }
}
type RuntimeState = Awaited<ReturnType<typeof state>>;
type Actor = {
  context: APIRequestContext;
  email: string;
  password: string;
  id?: string;
};
const actors: Actor[] = [];
const timings: number[] = [];
const statuses: Record<string, number> = {};
const events: { atMs: number; state: RuntimeState }[] = [];
const cleanup: boolean[] = [];
const counters = {
  reads: 0,
  mismatches: 0,
  passwordChanges: 0,
  revocations: 0,
  relogins: 0,
  abortedProbes: 0,
  completedProbes: 0,
};
let initial: RuntimeState | undefined;
let started = 0;
let failure: string | undefined;
let verified = false;
async function call(
  context: APIRequestContext,
  path: string,
  expected: number,
  method = "GET",
  data?: unknown,
  owner?: string,
) {
  const began = performance.now();
  let response;
  try {
    response = await context.fetch(`/api/${path}`, {
      method,
      timeout: 5000,
      ...(data === undefined ? {} : { data }),
      ...(owner === undefined
        ? {}
        : { headers: { [accountIntentHeader]: owner } }),
    });
  } catch {
    throw new CheckFailure(`transport:${method}:${path}`);
  }
  try {
    timings.push(performance.now() - began);
    const key = `${method} ${path} ${response.status()}`;
    statuses[key] = (statuses[key] ?? 0) + 1;
    requireCheck(
      response.status() === expected,
      `status:${method}:${path}:${response.status()}`,
    );
    return await response.json();
  } finally {
    await response.dispose();
  }
}

/** Abort after bytes were written, without logging or persisting session cookies. */
async function abortProbe(actor: Actor) {
  const cookies = (await actor.context.storageState()).cookies
    .filter((cookie) => cookie.domain.replace(/^\./, "") === "localhost")
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  requireCheck(cookies.length > 0, "probe_missing_cookie");
  return new Promise<"aborted" | "completed">((resolve, reject) => {
    let settled = false,
      deliberate = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: "aborted" | "completed", code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code) reject(new CheckFailure(code));
      else resolve(result!);
    };
    const pending = httpRequest({
      hostname: "127.0.0.1",
      port: 3000,
      path: "/api/auth/get-session",
      method: "GET",
      headers: {
        Host: "localhost:3000",
        Origin: baseURL,
        Cookie: cookies,
        "X-Forwarded-For": network,
        [accountIntentHeader]: actor.id!,
      },
    });
    pending.on("finish", () => {
      timer = setTimeout(() => {
        deliberate = true;
        pending.destroy(new Error("QA_ABORT"));
      }, 5);
    });
    pending.on("error", () =>
      finish(
        deliberate ? "aborted" : undefined,
        deliberate ? undefined : "probe_transport_error",
      ),
    );
    pending.setTimeout(5000, () => {
      pending.destroy();
      finish(undefined, "probe_timeout");
    });
    pending.on("response", (response) => {
      clearTimeout(timer);
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 16384) {
          pending.destroy();
          finish(undefined, "probe_body_limit");
        } else chunks.push(chunk);
      });
      response.on("error", () =>
        finish(
          deliberate ? "aborted" : undefined,
          deliberate ? undefined : "probe_response_error",
        ),
      );
      response.on("end", () => {
        try {
          requireCheck(response.statusCode === 200, "probe_status");
          requireCheck(
            JSON.parse(Buffer.concat(chunks).toString("utf8")).user?.id ===
              actor.id,
            "probe_identity",
          );
          finish("completed");
        } catch {
          finish(undefined, "probe_response_invalid");
        }
      });
    });
    pending.end();
  });
}

try {
  initial = await state();
  requireCheck(initial.status === "running", "runtime_not_running");
  const setup = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, "X-Forwarded-For": network },
  });
  try {
    const config = await call(setup, "public-config", 200);
    requireCheck(
      config.localMailbox === true &&
        config.emailVerificationRequired === false,
      "requires_local_mailbox_and_optional_verification",
    );
  } finally {
    await setup.dispose();
  }
  for (let index = 0; index < 2; index++) {
    const actor: Actor = {
      context: await request.newContext({
        baseURL,
        extraHTTPHeaders: { Origin: baseURL, "X-Forwarded-For": network },
      }),
      email: `soak-${run}-${index}@example.test`,
      password: randomBytes(24).toString("hex"),
    };
    actors.push(actor);
    const signup = await call(
      actor.context,
      "auth/sign-up/email",
      200,
      "POST",
      {
        name: `Synthetic auth soak ${run}`,
        email: actor.email,
        password: actor.password,
        callbackURL: "/",
      },
    );
    actor.id = signup.user?.id;
    requireCheck(actor.id, "signup_identity_missing");
    await call(actor.context, "auth/sign-in/email", 200, "POST", {
      email: actor.email,
      password: actor.password,
    });
    requireCheck(
      (await call(actor.context, "auth/get-session", 200)).user?.id ===
        actor.id,
      "initial_identity",
    );
  }
  const afterSetup = await state();
  requireCheck(
    JSON.stringify(afterSetup) === JSON.stringify(initial),
    "runtime_changed_during_setup",
  );
  started = performance.now();
  let tick = 0,
    nextMutation = 2000,
    nextRelogin = 5000,
    nextProbe = 7000,
    nextObservation = 0;
  console.log(
    JSON.stringify({
      event: "started",
      run,
      seconds,
      image: initial.image,
      pacePerSecond: 2,
    }),
  );
  while (performance.now() - started < seconds * 1000) {
    const began = performance.now();
    const actor = actors[tick % 2];
    if (tick % 11 === 10) {
      const denied = await call(
        actor.context,
        "auth/get-session",
        409,
        "GET",
        undefined,
        actors[(tick + 1) % 2].id,
      );
      requireCheck(
        denied.code === "SESSION_CHANGED" && denied.user === undefined,
        "mismatch_not_isolated",
      );
      counters.mismatches++;
    } else if (tick % 15 === 14) {
      requireCheck(
        (await call(actor.context, "profile", 200, "GET", undefined, actor.id))
          .email === actor.email,
        "profile_identity",
      );
      counters.reads++;
    } else {
      requireCheck(
        (
          await call(
            actor.context,
            "auth/get-session",
            200,
            "GET",
            undefined,
            actor.id,
          )
        ).user?.id === actor.id,
        "session_identity",
      );
      counters.reads++;
    }
    const elapsed = performance.now() - started;
    if (elapsed >= nextMutation) {
      const nextPassword = randomBytes(24).toString("hex");
      await call(
        actors[0].context,
        "auth/change-password",
        200,
        "POST",
        {
          currentPassword: actors[0].password,
          newPassword: nextPassword,
          revokeOtherSessions: true,
        },
        actors[0].id,
      );
      actors[0].password = nextPassword;
      counters.passwordChanges++;
      await call(
        actors[1].context,
        "auth/revoke-other-sessions",
        200,
        "POST",
        {},
        actors[1].id,
      );
      counters.revocations++;
      nextMutation += 60000;
    }
    if (elapsed >= nextRelogin) {
      await call(
        actors[1].context,
        "auth/sign-out",
        200,
        "POST",
        {},
        actors[1].id,
      );
      await call(actors[1].context, "auth/sign-in/email", 200, "POST", {
        email: actors[1].email,
        password: actors[1].password,
      });
      counters.relogins++;
      nextRelogin += 120000;
    }
    if (elapsed >= nextProbe) {
      counters[
        (await abortProbe(
          actors[(counters.abortedProbes + counters.completedProbes) % 2],
        )) === "aborted"
          ? "abortedProbes"
          : "completedProbes"
      ]++;
      nextProbe += 15000;
    }
    if (elapsed >= nextObservation) {
      const current = await state();
      events.push({ atMs: Math.round(elapsed), state: current });
      requireCheck(
        JSON.stringify(current) === JSON.stringify(initial),
        "runtime_changed",
      );
      await call(actor.context, "health/ready", 200);
      console.log(
        JSON.stringify({
          event: "progress",
          run,
          elapsedSeconds: Math.round(elapsed / 1000),
          ...counters,
          restarts: current.restarts,
        }),
      );
      nextObservation += 30000;
    }
    tick++;
    await pause(Math.max(0, 500 - (performance.now() - began)));
  }
  const final = await state();
  events.push({ atMs: Math.round(performance.now() - started), state: final });
  requireCheck(
    JSON.stringify(final) === JSON.stringify(initial),
    "runtime_changed_at_end",
  );
  verified = true;
} catch (error) {
  failure = error instanceof CheckFailure ? error.message : "unexpected_error";
  try {
    events.push({
      atMs: started ? Math.round(performance.now() - started) : 0,
      state: await state(),
    });
  } catch {
    /* Observation failure is already represented by the failed check. */
  }
} finally {
  for (const actor of actors) {
    let removed = false;
    try {
      if (actor.id) {
        await call(actor.context, "account", 200, "DELETE", {}, actor.id);
        await call(actor.context, "profile", 401, "GET", undefined, actor.id);
        removed = true;
      }
    } catch {
      /* Never replay an uncertain mutation or delete an unidentified owner. */
    }
    cleanup.push(removed);
    try {
      await actor.context.dispose();
    } catch {
      failure ??= "client_disposal_failed";
      verified = false;
    }
  }
}
try {
  const afterCleanup = await state();
  events.push({
    atMs: started ? Math.round(performance.now() - started) : 0,
    state: afterCleanup,
  });
  if (initial && JSON.stringify(afterCleanup) !== JSON.stringify(initial)) {
    failure ??= "runtime_changed_during_cleanup";
    verified = false;
  }
} catch {
  failure ??= "runtime_observation_failed_after_cleanup";
  verified = false;
}
timings.sort((a, b) => a - b);
const report = {
  date: new Date().toISOString(),
  run,
  requestedSeconds: seconds,
  environment:
    "Owned localhost production web; synthetic users, real PostgreSQL; isolated local benchmark-IP budget",
  durationSeconds: started
    ? Math.round((performance.now() - started) / 1000)
    : 0,
  initial,
  observations: events,
  counters,
  statuses,
  latencyMs: {
    p50: Math.round(timings[Math.floor(timings.length * 0.5)] ?? 0),
    p95: Math.round(timings[Math.floor(timings.length * 0.95)] ?? 0),
    max: Math.round(timings.at(-1) ?? 0),
  },
  fixtureCleanup: cleanup,
  failure: failure ?? null,
  verified: verified && cleanup.every(Boolean) && actors.length === 2,
  limits:
    "Bounded local mixed-auth soak, not a cloud capacity benchmark or proof that the isolated exit 139 is fixed; request cancellation probes may complete before their deadline",
};
await mkdir("docs/reports", { recursive: true });
await writeFile(
  "docs/reports/auth-soak.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    event: "finished",
    ...report,
    observations: report.observations.length,
  }),
);
if (!report.verified) process.exitCode = 1;
