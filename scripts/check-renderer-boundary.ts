import { request } from "node:http";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { env } from "../apps/web/lib/env";

const settings = env();
const origin = new URL(settings.RENDERER_URL);
if (
  !settings.RENDERER_TOKEN ||
  !["localhost", "127.0.0.1"].includes(origin.hostname)
)
  throw new Error(
    "This boundary check is restricted to the configured local renderer.",
  );
function probe(path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const call = request(
      new URL(path, origin),
      { method: "POST", headers, timeout: 3000 },
      (response) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );
    call.on("timeout", () =>
      call.destroy(new Error("Renderer check timed out")),
    );
    call.on("error", reject);
    call.end();
  });
}
const auth = {
  Authorization: `Bearer ${settings.RENDERER_TOKEN}`,
  "X-Format": "docx",
};
assert.equal(await probe("/inspect", {}), 401);
assert.equal(await probe("/unknown", auth), 404);
assert.equal(
  await probe("/inspect", { ...auth, "Content-Length": "broken" }),
  400,
);
assert.equal(
  await probe("/inspect", { ...auth, "Content-Length": "999999999" }),
  413,
);
assert.equal((await fetch(new URL("/health", origin))).status, 200);
const report = {
  date: new Date().toISOString(),
  scope: "Local isolated renderer HTTP boundary; no private files used",
  unauthenticatedRejected: true,
  unknownOperationRejectedBeforeBody: true,
  malformedLengthRejected: true,
  oversizedBodyRejected: true,
  healthyAfterRejections: true,
};
await writeFile(
  "docs/reports/renderer-boundary.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
