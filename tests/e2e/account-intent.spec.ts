import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { verifiedUser, headers, authRequest } from "./helpers";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { accountIntentHeader } from "../../packages/contracts/account-intent";

test("account intent fences business reads and writes without becoming an authentication credential", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const first = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const second = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  const anonymous = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    await verifiedUser(second);
    const next = (await (await second.get("/api/auth/get-session")).json()).user
      .id;
    const before = await (await second.get("/api/profile")).json();
    for (const [path, method] of [
      ["profile", "PATCH"],
      ["account", "DELETE"],
      ["demo", "POST"],
      ["uploads", "POST"],
      ["uploads/init", "POST"],
      ["ktp/imports", "POST"],
      ["generations", "POST"],
      ["exports", "POST"],
      ["drafts", "POST"],
      ["profile", "GET"],
      ["history", "GET"],
      ["ktp/collection", "GET"],
    ]) {
      const response = await second.fetch(`/api/${path}`, {
        method,
        headers: { ...headers, [accountIntentHeader]: first },
        ...(method === "GET" ? {} : { data: {} }),
      });
      expect(response.status(), `${method} ${path}`).toBe(409);
      expect((await response.json()).code).toBe("SESSION_CHANGED");
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
    expect(await (await second.get("/api/profile")).json()).toEqual(before);
    expect(await (await second.get("/api/jobs")).json()).toEqual([]);
    expect(
      (
        await anonymous.patch("/api/profile", {
          headers: { ...headers, [accountIntentHeader]: next },
          data: {},
        })
      ).status(),
    ).toBe(401);
    const matching = { ...headers, [accountIntentHeader]: next };
    expect(
      (
        await second.patch("/api/profile", {
          headers: matching,
          data: { ...before, school: "Synthetic matching account" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await second.get("/api/profile", { headers: matching })).json())
        .school,
    ).toBe("Synthetic matching account");
    // Existing non-browser clients omit the hint and still use normal session authorization.
    expect((await second.get("/api/profile")).status()).toBe(200);
    expect(
      (await (await second.get("/api/auth/get-session")).json()).user.id,
    ).toBe(next);
  } finally {
    await second.dispose();
    await anonymous.dispose();
  }
});

test("native auth intent refuses another owner and allows matching or already-invalidated sign-out", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const first = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const second = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  const anonymous = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    await verifiedUser(second);
    const next = (await (await second.get("/api/auth/get-session")).json()).user
      .id;
    for (const [path, method] of [
      ["change-password", "POST"],
      ["revoke-other-sessions", "POST"],
      ["sign-out", "POST"],
      ["sign-out/", "POST"],
      ["%73ign-out", "POST"],
      ["list-sessions", "GET"],
      ["get-session", "GET"],
    ]) {
      const response = await authRequest(() =>
        second.fetch(`/api/auth/${path}`, {
          method,
          headers: { ...headers, [accountIntentHeader]: first },
          ...(method === "GET" ? {} : { data: {} }),
        }),
      );
      expect(response.status(), `${method} ${path}`).toBe(409);
      expect((await response.json()).code).toBe("SESSION_CHANGED");
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers().vary?.toLowerCase()).toContain("cookie");
    }
    expect((await second.get("/api/profile")).status()).toBe(200);
    expect((await request.get("/api/profile")).status()).toBe(200);
    expect(
      (
        await anonymous.post("/api/auth/revoke-other-sessions", {
          headers: { ...headers, [accountIntentHeader]: next },
          data: {},
        })
      ).status(),
    ).toBe(401);
    const matching = { ...headers, [accountIntentHeader]: next };
    expect(
      (
        await second.post("/api/auth/revoke-other-sessions", {
          headers: matching,
          data: {},
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await second.post("/api/auth/sign-out", {
          headers: { ...matching, Origin: "https://untrusted.example.test" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await second.post("/api/auth/sign-out", { headers: matching, data: {} })
      ).status(),
    ).toBe(200);
    expect((await second.get("/api/profile")).status()).toBe(401);
    expect(
      (
        await second.post("/api/auth/sign-out", { headers: matching, data: {} })
      ).status(),
    ).toBe(200);
  } finally {
    await second.dispose();
    await anonymous.dispose();
  }
});

test("rejected password intent still consumes the native three-attempt budget", async ({
  request,
}) => {
  await verifiedUser(request);
  const origin = {
    ...headers,
    "x-forwarded-for": `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`,
    [accountIntentHeader]: "synthetic-different-owner",
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request.post("/api/auth/change-password", {
      headers: origin,
      data: {},
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("SESSION_CHANGED");
  }
  const limited = await request.post("/api/auth/change-password", {
    headers: origin,
    data: {},
  });
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["x-retry-after"])).toBeGreaterThan(0);
  expect((await request.get("/api/profile")).status()).toBe(200);
});

test("a rejected native intent never refreshes the other account's aged session", async ({
  request,
}) => {
  await verifiedUser(request);
  const current = await (await request.get("/api/auth/get-session")).json();
  const pool = new Pool({
    connectionString: parseEnv(await readFile(".env.local", "utf8"))
      .DATABASE_URL,
  });
  try {
    await pool.query(
      "UPDATE session SET \"updatedAt\"=now()-interval '2 days',\"expiresAt\"=now()+interval '5 days' WHERE id=$1",
      [current.session.id],
    );
    const before = (
      await pool.query(
        'SELECT "updatedAt"::text AS updated,"expiresAt"::text AS expires FROM session WHERE id=$1',
        [current.session.id],
      )
    ).rows[0];
    const rejected = await request.post("/api/auth/revoke-other-sessions", {
      headers: {
        ...headers,
        [accountIntentHeader]: "synthetic-different-owner",
      },
      data: {},
    });
    expect(rejected.status()).toBe(409);
    const after = (
      await pool.query(
        'SELECT "updatedAt"::text AS updated,"expiresAt"::text AS expires FROM session WHERE id=$1',
        [current.session.id],
      )
    ).rows[0];
    expect(after.updated === before.updated).toBe(true);
    expect(after.expires === before.expires).toBe(true);
    expect(rejected.headers()["set-cookie"]).toBeUndefined();
  } finally {
    await pool.end();
  }
});

test("parallel native session checks isolate matching and mismatching account intent", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const first = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const second = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    await verifiedUser(second);
    const next = (await (await second.get("/api/auth/get-session")).json()).user
      .id;
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        for (const [client, own, other] of [
          [request, first, next],
          [second, next, first],
        ] as const) {
          const accepted = await client.get("/api/auth/get-session", {
            headers: { [accountIntentHeader]: own },
          });
          expect(accepted.status()).toBe(200);
          expect((await accepted.json()).user.id).toBe(own);
          const denied = await client.get("/api/auth/get-session", {
            headers: { [accountIntentHeader]: other },
          });
          expect(denied.status()).toBe(409);
          expect((await denied.json()).code).toBe("SESSION_CHANGED");
          expect(denied.headers()["set-cookie"]).toBeUndefined();
        }
      }),
    );
  } finally {
    await second.dispose();
  }
});
