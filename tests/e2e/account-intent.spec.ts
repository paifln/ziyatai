import { test, expect } from "@playwright/test";
import { verifiedUser, headers } from "./helpers";
import { accountIntentHeader } from "../../packages/contracts/account-intent";

test("account intent fences business reads and writes without becoming an authentication credential", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const first = (await (await request.get("/api/auth/get-session")).json()).user
    .id;
  const second = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  const anonymous = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
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
