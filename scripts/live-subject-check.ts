import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { generate } from "../apps/worker/ai";
import { env } from "../apps/web/lib/env";

if (process.env.LIVE_AI_CHECK !== "1")
  throw new Error(
    "Set LIVE_AI_CHECK=1 explicitly. This check makes at most three live generation calls (with bounded internal repairs) and incurs API charges.",
  );
const settings = env();
if (!settings.OPENAI_API_KEY || !settings.OPENAI_MODEL)
  throw new Error("Configure the server-side OpenAI key and model first.");
const cases = [
  {
    key: "math-ru",
    subject: "mathematics",
    grade: 6,
    locale: "ru",
    topic: "Проценты",
    goals:
      "Находить процент от натурального числа и объяснять способ решения на примерах из повседневной жизни.",
  },
  {
    key: "biology-kk",
    subject: "biology",
    grade: 7,
    locale: "kk",
    topic: "Өсімдік жасушасының құрылысы",
    goals:
      "Өсімдік жасушасының негізгі бөліктерін атау және олардың қызметін түсіндіру.",
  },
  {
    key: "math-bilingual",
    subject: "mathematics",
    grade: 5,
    locale: "kk+ru",
    topic: "Жай бөлшектерді салыстыру",
    goals:
      "Бөлімдері бірдей жай бөлшектерді салыстыру және салыстыру нәтижесін негіздеу.",
  },
];
await mkdir(".local/ai-eval/subjects", { recursive: true });
const results = [];
for (const scenario of cases) {
  const { key, ...source } = scenario;
  const snapshot = {
    ...source,
    id: randomUUID(),
    objectiveCodes: ["manual"],
    count: 1,
    minutes: 15,
    constraints:
      "Use only synthetic non-personal examples. No internet or external tools are available.",
    format: "mixed",
    demo: false,
  };
  const started = Date.now();
  try {
    const result = await generate(snapshot);
    const document = JSON.stringify(result.doc, null, 2);
    await writeFile(`.local/ai-eval/subjects/${key}.json`, document);
    results.push({
      key,
      subject: source.subject,
      grade: source.grade,
      locale: source.locale,
      result: "passed",
      tasks: result.doc!.tasks.length,
      levelCounts: Object.fromEntries(
        ["easy", "medium", "advanced"].map((level) => [
          level,
          result.doc!.tasks.filter((task) => task.level === level).length,
        ]),
      ),
      usage: result.usage,
      durationMs: Date.now() - started,
      documentSha256: createHash("sha256").update(document).digest("hex"),
    });
  } catch (error) {
    const failure = error as { code?: string; validationIssues?: string[] };
    results.push({
      key,
      result: "failed",
      code: failure.code || "INTERNAL",
      validationIssues: failure.validationIssues || [],
      durationMs: Date.now() - started,
    });
    process.exitCode = 1;
  }
}
const report = {
  date: new Date().toISOString(),
  model: settings.OPENAI_MODEL,
  liveProvider: true,
  source:
    "Three synthetic subject scenarios; no owner workbook or personal data sent",
  publicDeployment: false,
  pedagogicalExpertReview: "not performed; teacher review still required",
  cases: results,
};
await writeFile(
  "docs/reports/live-subjects.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
