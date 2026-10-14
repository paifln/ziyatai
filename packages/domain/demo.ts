import { randomUUID } from "node:crypto";
import type { GenerationDocument, KtpRow, TaskDocument } from "../contracts";
const paragraph = (text: string) => ({
  type: "paragraph" as const,
  text,
  items: [],
  columns: [],
  rows: [],
  language: "",
});
export function syntheticDemo(locale: "kk" | "ru") {
  const ru = locale === "ru";
  const topic = ru ? "Линейные алгоритмы" : "Сызықтық алгоритмдер";
  const goals = ru
    ? "Составлять и объяснять последовательность действий для решения задачи."
    : "Есепті шешу үшін әрекеттер тізбегін құру және түсіндіру.";
  const row: KtpRow = {
    id: randomUUID(),
    sourceOrder: 1,
    lessonNumberRaw: "1",
    section: ru ? "Алгоритмы" : "Алгоритмдер",
    quarter: "I",
    topic,
    goals,
    objectiveCodes: [],
    lessonGoals: "",
    hours: "1",
    dateRaw: "",
    dateStart: null,
    dateEnd: null,
    notes: ru
      ? "Синтетический образец, не официальный учебный план."
      : "Синтетикалық үлгі, ресми оқу жоспары емес.",
    warnings: ["missing_date"],
    source: {
      page: null,
      sheet: null,
      range: "synthetic:1",
      fragment: topic,
      method: "manual",
      confidence: 1,
    },
  };
  const snapshot = {
    id: randomUUID(),
    topic,
    goals,
    objectiveCodes: ["manual"],
    grade: 7,
    locale,
    count: 3,
    minutes: 30,
    constraints: "",
    format: "logic",
    demo: true,
  };
  const tasks: TaskDocument[] = [];
  for (const level of ["easy", "medium", "advanced"] as const)
    for (let n = 0; n < 3; n++) {
      const start = 2 + n;
      const advanced = level === "advanced";
      const medium = level === "medium";
      const expected = advanced
        ? (start + 3) * 2
        : medium
          ? start * 2 + 3
          : start + 3;
      const condition = advanced
        ? ru
          ? `Нужно сначала прибавить 3 к числу ${start}, затем умножить результат на 2. Ученик записал алгоритм «умножить на 2, прибавить 3». Найдите ошибку, запишите правильный алгоритм и результат.`
          : `Алдымен ${start} санына 3 қосып, содан кейін нәтижені 2-ге көбейту керек. Оқушы «2-ге көбейту, 3 қосу» алгоритмін жазды. Қатені тауып, дұрыс алгоритм мен нәтижені жазыңыз.`
        : medium
          ? ru
            ? `Дано число ${start}. Умножьте его на 2, затем прибавьте 3. Запишите два шага алгоритма и итоговое число.`
            : `${start} саны берілген. Оны 2-ге көбейтіп, содан кейін 3 қосыңыз. Алгоритмнің екі қадамын және нәтижесін жазыңыз.`
          : ru
            ? `Дано число ${start}. Прибавьте к нему 3. Запишите действие и результат.`
            : `${start} саны берілген. Оған 3 қосыңыз. Әрекет пен нәтижені жазыңыз.`;
      tasks.push({
        id: randomUUID(),
        level,
        objectiveRefs: ["manual"],
        estimatedMinutes: advanced ? 5 : medium ? 3 : 2,
        points: advanced ? 3 : medium ? 2 : 1,
        contentBlocks: [paragraph(condition)],
        answerBlocks: [paragraph(String(expected))],
        explanationHow: ru
          ? advanced
            ? `1. ${start} + 3 = ${start + 3}. 2. ${start + 3} × 2 = ${expected}.`
            : medium
              ? `1. ${start} × 2 = ${start * 2}. 2. ${start * 2} + 3 = ${expected}.`
              : `${start} + 3 = ${expected}.`
          : advanced
            ? `1. ${start} + 3 = ${start + 3}. 2. ${start + 3} × 2 = ${expected}.`
            : medium
              ? `1. ${start} × 2 = ${start * 2}. 2. ${start * 2} + 3 = ${expected}.`
              : `${start} + 3 = ${expected}.`,
        explanationWhy: ru
          ? "Каждый шаг использует результат предыдущего. Порядок действий влияет на результат."
          : "Әр қадам алдыңғы нәтижені қолданады. Әрекеттердің реті нәтижеге әсер етеді.",
        rubric: [
          {
            criterion: ru
              ? "Правильная последовательность и результат"
              : "Дұрыс әрекеттер реті және нәтиже",
            points: advanced ? 3 : medium ? 2 : 1,
          },
        ],
        verificationCases: [],
        translation: null,
      });
    }
  const document: GenerationDocument = {
    schemaVersion: "1.0",
    localeMode: locale,
    sourceSnapshotId: snapshot.id,
    title: topic,
    grade: 7,
    tasks,
    warnings: [
      ru
        ? "Синтетическое демо: OpenAI не вызывался."
        : "Синтетикалық демо: OpenAI шақырылмаған.",
    ],
  };
  return { row, snapshot, document };
}
