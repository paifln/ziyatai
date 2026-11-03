import { origin as qaOrigin } from "./helpers";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { headers, verifiedUser, approveGeneration } from "./helpers";

test("OPTIONS and unsupported PUT use the path-specific contract without exposing data", async ({
  request,
}) => {
  const options = await request.fetch("/api/profile", { method: "OPTIONS" });
  expect(options.status()).toBe(204);
  expect(options.headers().allow).toBe("GET, PATCH, OPTIONS");
  expect(await options.body()).toHaveLength(0);
  const wrong = await request.put("/api/profile", { headers, data: {} });
  expect(wrong.status()).toBe(405);
  expect(wrong.headers().allow).toBe("GET, PATCH, OPTIONS");
  expect(
    (await request.fetch("/api/profile/extra", { method: "OPTIONS" })).status(),
  ).toBe(404);
  expect((await request.get("/api/profile")).status()).toBe(401);
});

test("DELETE on a read-only KTP subresource never deletes the material", async ({
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const before = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const response = await request.delete(`/api/ktp/${demo.planId}/preview`, {
    headers,
  });
  const after = await request.get(`/api/ktp/${demo.planId}`);
  expect(
    after.status(),
    "Malformed deletion must leave this synthetic KTP alive",
  ).toBe(200);
  expect(response.status()).toBe(405);
  expect(response.headers().allow).toBe("GET, OPTIONS");
  expect(await after.json()).toEqual(before);
});

test("unsupported path and method matrix cannot mutate an account or approved material", async ({
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const plan = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const pending = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  await approveGeneration(request, demo.id, pending.revision);
  const generation = await (
    await request.get(`/api/generations/${demo.id}`)
  ).json();
  const profile = await (await request.get("/api/profile")).json();
  const cases = [
    ["DELETE", "account/extra", 404],
    ["PATCH", "profile/settings", 404],
    ["POST", "demo/extra", 404],
    ["DELETE", `ktp/${demo.planId}/unknown`, 404],
    ["GET", `ktp/${demo.planId}/unknown`, 404],
    ["PATCH", `ktp/${demo.planId}/rows/extra`, 404],
    ["DELETE", `generations/${demo.id}/document`, 405],
    ["GET", `generations/${demo.id}/approve`, 405],
    ["PATCH", `generations/${demo.id}/document/extra`, 404],
    [
      "POST",
      `generations/${demo.id}/tasks/${generation.document.tasks[0].id}/regenerate/extra`,
      404,
    ],
    ["GET", `jobs/${randomUUID()}/cancel`, 405],
    ["DELETE", `exports/${randomUUID()}/download`, 405],
    ["POST", "uploads/init/extra", 404],
    ["GET", "uploads/init", 405],
    ["GET", "ktp/imports", 405],
    ["GET", "library/extra", 404],
    ["GET", "history/extra", 404],
    ["POST", `drafts/${randomUUID()}/discard/extra`, 404],
  ] as const;
  for (const [method, path, status] of cases) {
    const response = await request.fetch(`/api/${path}`, {
      method,
      headers,
      ...(method === "GET" ? {} : { data: {} }),
    });
    expect(response.status(), `${method} ${path}`).toBe(status);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.json()).code).toBe(
      status === 404 ? "NOT_FOUND" : "METHOD_NOT_ALLOWED",
    );
  }
  expect(await (await request.get(`/api/ktp/${demo.planId}`)).json()).toEqual(
    plan,
  );
  expect(
    await (await request.get(`/api/generations/${demo.id}`)).json(),
  ).toEqual(generation);
  expect(await (await request.get("/api/profile")).json()).toEqual(profile);
});

test("canonical editing and ownership guards survive route admission", async ({
  request,
  playwright,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const before = await (await request.get(`/api/ktp/${demo.planId}`)).json();
  const other = await playwright.request.newContext({
    baseURL: qaOrigin,
  });
  try {
    await verifiedUser(other);
    expect(
      (await other.delete(`/api/ktp/${demo.planId}`, { headers })).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(`/api/ktp/${demo.planId}/rows`, { data: {} })
      ).status(),
    ).toBe(403);
    const edited = await request.patch(`/api/ktp/${demo.planId}/rows`, {
      headers,
      data: {
        revision: before.revision,
        rows: before.rows,
        grade: before.grade,
        schoolYear: before.school_year,
      },
    });
    expect(edited.status(), await edited.text()).toBe(200);
    const deleted = await request.delete(`/api/ktp/${demo.planId}`, {
      headers,
    });
    expect(deleted.status()).toBe(200);
    expect((await request.get(`/api/ktp/${demo.planId}`)).status()).toBe(404);
  } finally {
    await other.dispose();
  }
});
