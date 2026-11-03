import { generate } from "../../apps/worker/ai";
import { syntheticDemo } from "../../packages/domain/demo";
import { db } from "../../apps/web/lib/db";
import { env } from "../../apps/web/lib/env";
import { writeFile, mkdir } from "node:fs/promises";
if (!env().OPENAI_API_KEY || !env().OPENAI_MODEL) {
  console.log(
    "BLOCKED: configure OPENAI_API_KEY and OPENAI_MODEL securely; no live request made.",
  );
  process.exitCode = 2;
} else {
  const sample = syntheticDemo("kk");
  const started = Date.now();
  const result = await generate({ ...sample.snapshot, demo: false });
  await mkdir(".local/ai-eval", { recursive: true });
  await writeFile(
    ".local/ai-eval/smoke.json",
    JSON.stringify(result.doc, null, 2),
  );
  console.log(
    JSON.stringify({
      model: result.model,
      status: result.report?.status,
      usage: result.usage,
      durationMs: Date.now() - started,
      pedagogicalExpertReview: "not performed",
    }),
  );
}
await db().end();
