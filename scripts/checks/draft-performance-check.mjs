/** Offline, synthetic serialization experiment; no accounts, database or AI calls. */
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["scripts/build/build-lite.mjs", "--check"], {
  windowsHide: true,
});
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({
    content: await readFile("public/lite/draft-merge.js", "utf8"),
  });
  const cdp = await page.context().newCDPSession(page);
  const results = [];
  for (const cpuRate of [1, 6]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    for (const count of [200, 2000]) {
      const result = await page.evaluate(
        ({ count, samples }) => {
          const base = {
            grade: 7,
            schoolYear: "2026–2027",
            rows: Array.from({ length: count }, (_, index) => ({
              id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
              sourceOrder: index + 1,
              lessonNumberRaw: String(index + 1),
              section: "Алгебра",
              quarter: "1",
              topic: "Линейные уравнения",
              goals:
                "Решать линейные уравнения и проверять найденные решения. ".repeat(
                  3,
                ),
              objectiveCodes: ["7.2.2.1"],
              lessonGoals: "",
              hours: "1",
              dateRaw: "",
              dateSkipped: true,
              dateStart: null,
              dateEnd: null,
              notes: "",
              warnings: [],
              source: {
                page: null,
                sheet: "7 класс",
                range: `A${index + 1}:H${index + 1}`,
                fragment: "Линейные уравнения",
                method: "digital",
                confidence: 1,
              },
            })),
          };
          const edited = { ...base, rows: base.rows.slice() };
          edited.rows[count - 1] = {
            ...edited.rows[count - 1],
            notes: "Изменение последней строки",
          };
          const liteBase = JSON.parse(JSON.stringify(base));
          const liteEdited = JSON.parse(JSON.stringify(edited));
          const names = [
            "mainFull",
            "mainCompact",
            "liteFull",
            "liteCompact",
            "liteSharedSnapshot",
          ];
          const timings = names.map(() => []);
          function run(method) {
            if (method === 4) {
              const payload = window.ZiyatDraftPayload.compactPlanDraft(
                liteBase,
                liteEdited,
              );
              const wire = JSON.parse(JSON.stringify(payload));
              const snapshot = window.ZiyatDraftPayload.expandPlanDraft(
                liteBase,
                wire,
              );
              if (snapshot.rows.length !== count)
                throw new Error("Incomplete snapshot");
              return JSON.stringify(wire).length;
            }
            const lite = method >= 2;
            const snapshot = lite
              ? JSON.parse(JSON.stringify(liteEdited))
              : edited;
            return JSON.stringify(
              method % 2
                ? window.ZiyatDraftPayload.compactPlanDraft(
                    lite ? liteBase : base,
                    snapshot,
                  )
                : snapshot,
            ).length;
          }
          // Warm up all paths, then rotate their order to reduce ordering bias.
          for (let i = 0; i < 3; i++)
            for (let j = 0; j < names.length; j++) run(j);
          for (let i = 0; i < samples; i++) {
            for (let offset = 0; offset < names.length; offset++) {
              const method = (i + offset) % names.length;
              const before = performance.now();
              run(method);
              timings[method].push(performance.now() - before);
            }
          }
          const measure = (values) => {
            values.sort((a, b) => a - b);
            return {
              medianMs: +values[Math.floor(values.length / 2)].toFixed(2),
              p95Ms: +values[Math.ceil(values.length * 0.95) - 1].toFixed(2),
            };
          };
          return {
            rows: count,
            samplesPerMethod: samples,
            methods: Object.fromEntries(
              names.map((name, index) => [name, measure(timings[index])]),
            ),
          };
        },
        { count, samples: 24 },
      );
      results.push({ cpuRate, ...result });
    }
  }
  const report = {
    date: new Date().toISOString(),
    browser: await browser.version(),
    host: process.platform,
    scope:
      "Offline JavaScript snapshot preparation and serialization of a single last-row edit",
    methods: {
      mainFull: "Serialize a React-style immutable snapshot",
      mainCompact:
        "Build row references and serialize the same immutable snapshot",
      liteFull:
        "Clone a mutable Lite snapshot and serialize the complete snapshot",
      liteCompact:
        "Clone the same snapshot, build row references and serialize them",
      liteSharedSnapshot:
        "Build row references, clone only the wire payload, reconstruct the acknowledged snapshot against the private immutable baseline, and serialize the wire payload",
    },
    results,
    limitations: [
      "CPU rate 6 is Chromium emulation, not a physical school PC or Windows 7 benchmark",
      "No DOM rendering, network, database, continuous editing session or garbage collector controls",
      "These distributions are diagnostic observations, not universal performance guarantees or CI thresholds",
      "All data is generated synthetic curriculum; no server, account or paid AI usage",
    ],
  };
  const destination = resolve(
    process.argv[2] || ".local/qa/draft-performance.json",
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ browser: report.browser, results }));
} finally {
  await browser.close();
}
