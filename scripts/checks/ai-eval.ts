import { readFile, writeFile, mkdir } from "node:fs/promises";
import { generate } from "../../apps/worker/ai";
import { env } from "../../server/config/env";
const limit = Number(process.env.EVAL_REQUEST_LIMIT ?? "1");
if (
  process.env.EVAL_LIVE !== "1" ||
  !env().OPENAI_API_KEY ||
  !env().OPENAI_MODEL ||
  !Number.isInteger(limit) ||
  limit < 1 ||
  limit > 36
) {
  console.log(
    "BLOCKED: set EVAL_LIVE=1, an explicit EVAL_REQUEST_LIMIT (1..36), and provider secrets securely.",
  );
  process.exitCode = 2;
} else {
  const corpus = JSON.parse(await readFile("tests/ai/scenarios.json", "utf8"));
  const results = [];
  await mkdir(".local/ai-eval", { recursive: true });
  for (const scenario of corpus.cases.slice(0, limit)) {
    const { expertScores, expertReview, ...snapshot } = scenario;
    const started = Date.now();
    try {
      const result = await generate(snapshot);
      await writeFile(
        `.local/ai-eval/${scenario.id}.json`,
        JSON.stringify(result.doc, null, 2),
      );
      results.push({
        id: scenario.id,
        grade: scenario.grade,
        locale: scenario.locale,
        status: "needs_review",
        usage: result.usage,
        durationMs: Date.now() - started,
        expertScores,
        expertReview,
      });
    } catch (e) {
      results.push({
        id: scenario.id,
        status: "failed",
        code: (e as any).code ?? "INTERNAL",
      });
    }
  }
  await writeFile(
    ".local/ai-eval/report.json",
    JSON.stringify(
      {
        model: env().OPENAI_MODEL,
        live: true,
        scenarios: results,
        expertReview: "not performed; score manually before acceptance",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      model: env().OPENAI_MODEL,
      attempted: results.length,
      needsReview: results.filter((r) => r.status === "needs_review").length,
      failed: results.filter((r) => r.status === "failed").length,
    }),
  );
}
