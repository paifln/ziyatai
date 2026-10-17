import { test, expect } from "vitest";
import { assertApiRoute, ApiMethodError } from "../apps/web/lib/api-routes";

test("OPTIONS exposes only the methods for the exact business resource", () => {
  expect(assertApiRoute(["profile"], "OPTIONS")).toEqual(["GET", "PATCH"]);
  expect(assertApiRoute(["account"], "OPTIONS")).toEqual(["DELETE"]);
  expect(() => assertApiRoute(["account", "extra"], "OPTIONS")).toThrowError(
    expect.objectContaining({ status: 404 }),
  );
});

test("noncanonical suffixes never alias a material, profile or account", () => {
  for (const path of [
    ["account", "profile"],
    ["profile", "settings"],
    ["history", "extra"],
    ["ktp", "id", "unknown"],
    ["generations", "id", "document", "extra"],
    ["generations", "id", "tasks", "task", "regenerate", "extra"],
    ["uploads", "id", "complete", "extra"],
    ["exports", "id", "download", "extra"],
    ["drafts", "id", "discard", "extra"],
    ["jobs", "id", "cancel", "extra"],
    ["ktp", "id", "source/extra"],
    [],
    ["profile", ""],
  ])
    for (const method of ["GET", "POST", "PATCH", "DELETE", "HEAD"])
      expect(() => assertApiRoute(path, method)).toThrowError(
        expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
      );
});
test("a method mismatch never falls back to another operation", () => {
  for (const [path, method, allow] of [
    [["ktp", "id", "preview"], "DELETE", "GET"],
    [["generations", "id", "document"], "DELETE", "PATCH"],
    [["jobs", "id", "cancel"], "GET", "POST"],
    [["uploads", "init"], "GET", "POST"],
    [["ktp", "imports"], "GET", "POST"],
    [["exports", "id", "download"], "PATCH", "GET, HEAD"],
  ] as const) {
    try {
      assertApiRoute([...path], method);
      throw new Error("Route unexpectedly admitted");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiMethodError);
      expect(error).toMatchObject({ status: 405, allow: allow + ", OPTIONS" });
    }
  }
});
test("canonical uploads, edits, task replacement and explicit HEAD remain supported", () => {
  for (const [path, method] of [
    [["uploads", "init"], "POST"],
    [["uploads", "id"], "HEAD"],
    [["ktp", "imports"], "POST"],
    [["ktp", "id", "rows"], "PATCH"],
    [["ktp", "id", "rows"], "POST"],
    [["ktp", "id", "confirm"], "POST"],
    [["ktp", "id", "source"], "HEAD"],
    [["generations", "id", "document"], "PATCH"],
    [["generations", "id", "tasks", "task"], "PATCH"],
    [["generations", "id", "tasks", "task", "regenerate"], "POST"],
    [["drafts", "id", "discard"], "POST"],
    [["account"], "DELETE"],
  ] as const)
    expect(() => assertApiRoute([...path], method)).not.toThrow();
});
