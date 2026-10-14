import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const topics = [
  {
    grade: 5,
    ru: "Единицы измерения информации",
    kk: "Ақпараттың өлшем бірліктері",
    goalsRu:
      "Переводить количество информации из байтов в биты при заданном соотношении 1 байт = 8 бит.",
    goalsKk:
      "1 байт = 8 бит қатынасы берілгенде ақпарат көлемін байттан битке түрлендіру.",
  },
  {
    grade: 6,
    ru: "Линейные алгоритмы",
    kk: "Сызықтық алгоритмдер",
    goalsRu: "Составлять и объяснять последовательность действий.",
    goalsKk: "Әрекеттер тізбегін құру және түсіндіру.",
  },
  {
    grade: 7,
    ru: "Условный оператор Python",
    kk: "Python шартты операторы",
    goalsRu: "Применять if/else к полностью заданным числовым данным.",
    goalsKk: "Толық берілген сандық деректерге if/else қолдану.",
  },
  {
    grade: 8,
    ru: "Формулы в таблицах",
    kk: "Кестелердегі формулалар",
    goalsRu:
      "Вычислять сумму и среднее по приведённой таблице без внешних файлов.",
    goalsKk:
      "Сыртқы файлдарсыз берілген кесте бойынша қосынды мен орташа мәнді есептеу.",
  },
  {
    grade: 9,
    ru: "Логические выражения",
    kk: "Логикалық өрнектер",
    goalsRu: "Строить таблицы истинности для заданных AND, OR, NOT.",
    goalsKk: "Берілген AND, OR, NOT үшін ақиқат кестелерін құру.",
  },
  {
    grade: 10,
    ru: "Простые запросы SQL",
    kk: "Қарапайым SQL сұраулары",
    goalsRu: "Применять SELECT и WHERE к приведённой схеме и строкам таблицы.",
    goalsKk: "Берілген кесте сұлбасы мен жолдарына SELECT және WHERE қолдану.",
  },
];
const cases = topics.flatMap((topic) =>
  ["kk", "ru", "kk+ru"].flatMap((locale) =>
    [1, 3].map((count) => ({
      id: randomUUID(),
      grade: topic.grade,
      topic: locale === "ru" ? topic.ru : topic.kk,
      goals: locale === "ru" ? topic.goalsRu : topic.goalsKk,
      objectiveCodes: ["manual"],
      subject: "informatics",
      locale,
      count,
      minutes: 30,
      constraints:
        "All required data must be included. Synthetic corpus; not an official curriculum mapping.",
      format: "mixed",
      expertScores: {
        alignment: null,
        correctness: null,
        levels: null,
        clarity: null,
        language: null,
      },
      expertReview: "not performed",
    })),
  ),
);
await mkdir("tests/ai", { recursive: true });
await writeFile(
  "tests/ai/scenarios.json",
  JSON.stringify(
    { origin: "synthetic", officialCurriculum: false, cases },
    null,
    2,
  ),
);
console.log(`Prepared ${cases.length} scenarios; no OpenAI requests made.`);
