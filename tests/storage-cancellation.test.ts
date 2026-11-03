import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ endpoint: "" }));
vi.mock("../server/config/env", () => ({
  env: () => ({
    STORAGE_ENDPOINT: fixture.endpoint,
    STORAGE_REGION: "test",
    STORAGE_FORCE_PATH_STYLE: "true",
    STORAGE_ACCESS_KEY: "fixture-access",
    STORAGE_SECRET_KEY: "fixture-secret",
    STORAGE_BUCKET: "fixture",
  }),
}));
import {
  deleteObject,
  listQuarantinePage,
  objectMetadata,
  putObject,
  storageReady,
} from "../server/infrastructure/storage/storage";

let closed = 0;
let started = 0;
const server = createServer((request, response) => {
  request.resume();
  response.once("close", () => {
    if (!response.writableFinished) closed++;
  });
  started++;
  // Deliberately never return headers: the caller must cancel the SDK request.
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fixture.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it.each([
  [
    "put",
    (signal: AbortSignal) =>
      putObject("fixture", Buffer.from("synthetic"), "text/plain", signal),
  ],
  ["delete", (signal: AbortSignal) => deleteObject("fixture", signal)],
  ["metadata", (signal: AbortSignal) => objectMetadata("fixture", signal)],
  ["list", (signal: AbortSignal) => listQuarantinePage(undefined, signal)],
  ["readiness", (signal: AbortSignal) => storageReady(signal)],
] as const)(
  "cancels a stalled real S3 %s request",
  async (_name, operation) => {
    const before = closed;
    const beforeStarted = started;
    const abort = new AbortController();
    const pending = operation(abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    try {
      // Wait for the actual stalled exchange; an arbitrary short timer can
      // expire during SDK initialization on a busy CI host before a socket opens.
      await vi.waitFor(() => expect(started).toBe(beforeStarted + 1), {
        timeout: 5000,
      });
      abort.abort();
      await rejected;
      await vi.waitFor(() => expect(closed).toBe(before + 1));
    } finally {
      abort.abort();
      await pending.catch(() => undefined);
    }
  },
);
