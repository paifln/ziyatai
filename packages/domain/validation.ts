import { GenerationDoc, type GenerationDocument } from "../contracts";
import { arithmetic } from "./arithmetic";
export function validateDocument(
  value: unknown,
  snapshot: {
    id: string;
    grade: number;
    locale: string;
    count: number;
    objectiveCodes: string[];
  },
) {
  const doc = GenerationDoc.parse(value);
  const issues: string[] = [];
  let arithmeticChecked = 0;
  let unexecutedCases = 0;
  if (
    doc.sourceSnapshotId !== snapshot.id ||
    doc.grade !== snapshot.grade ||
    doc.localeMode !== snapshot.locale
  )
    issues.push("SNAPSHOT_MISMATCH");
  if (doc.tasks.length !== snapshot.count * 3) issues.push("TASK_COUNT");
  for (const level of ["easy", "medium", "advanced"])
    if (doc.tasks.filter((t) => t.level === level).length !== snapshot.count)
      issues.push("LEVEL_COUNT");
  const ids = new Set<string>();
  const conditions = new Set<string>();
  for (const t of doc.tasks) {
    if (ids.has(t.id)) issues.push("DUPLICATE_ID");
    ids.add(t.id);
    const condition = t.contentBlocks
      .map((b) => b.text + " " + b.items.join(" "))
      .join(" ")
      .normalize("NFKC")
      .trim()
      .toLowerCase();
    if (conditions.has(condition)) issues.push("DUPLICATE_TASK");
    conditions.add(condition);
    if (
      !condition ||
      !t.answerBlocks.length ||
      !t.explanationHow.trim() ||
      !t.explanationWhy.trim()
    )
      issues.push("MISSING_CONTENT");
    if (
      t.points < 1 ||
      t.points > 100 ||
      t.rubric.reduce((s, r) => s + r.points, 0) !== t.points ||
      t.rubric.some((r) => r.points < 0 || !r.criterion.trim())
    )
      issues.push("POINTS");
    if (t.estimatedMinutes < 1 || t.estimatedMinutes > 120)
      issues.push("DURATION");
    if (
      !t.objectiveRefs.length ||
      t.objectiveRefs.some((c) => !snapshot.objectiveCodes.includes(c))
    )
      issues.push("OBJECTIVE_REF");
    if (doc.localeMode === "kk+ru" && !t.translation)
      issues.push("TRANSLATION_MISSING");
    if (t.translation) {
      const numbers = (blocks: typeof t.contentBlocks) =>
        blocks
          .flatMap((b) => [b.text, ...b.items, ...b.rows.flat(), ...b.columns])
          .join(" ")
          .match(/-?\d+(?:\.\d+)?/g)
          ?.sort()
          .join("|") ?? "";
      if (
        numbers(t.contentBlocks) !== numbers(t.translation.contentBlocks) ||
        numbers(t.answerBlocks) !== numbers(t.translation.answerBlocks)
      )
        issues.push("TRANSLATION_NUMBERS");
    }
    for (const test of t.verificationCases) {
      const actual = arithmetic(test.input);
      const expected = arithmetic(test.expected);
      if (actual === null || expected === null) {
        unexecutedCases++;
        continue;
      }
      arithmeticChecked++;
      if (Math.abs(actual - expected) > 1e-9) issues.push("ARITHMETIC_ANSWER");
    }
    if (
      t.translation &&
      (t.translation.rubric.length !== t.rubric.length ||
        t.translation.rubric.some((r, i) => r.points !== t.rubric[i]?.points))
    )
      issues.push("TRANSLATION_POINTS");
    for (const b of [
      ...t.contentBlocks,
      ...t.answerBlocks,
      ...(t.translation?.contentBlocks ?? []),
      ...(t.translation?.answerBlocks ?? []),
    ]) {
      if (b.text.length > 20000 || b.items.length > 100 || b.rows.length > 200)
        issues.push("CONTENT_LIMIT");
      if (
        b.type === "table" &&
        (b.columns.length === 0 ||
          b.rows.some((r) => r.length !== b.columns.length))
      )
        issues.push("TABLE_SHAPE");
    }
  }
  return {
    issues: [...new Set(issues)],
    verification: { arithmeticChecked, unexecutedCases },
    status: "needs_review" as const,
    checks: [
      "schema",
      "snapshot",
      "levels",
      "rubric",
      "duplicates",
      "references",
    ],
    limitations: [
      "Pedagogical correctness requires teacher review",
      "Generated code has not been executed in a sandbox",
    ],
    doc,
  };
}
export function displayLevel(level: string, locale: string) {
  return locale === "ru"
    ? (
        { easy: "Лёгкий", medium: "Средний", advanced: "Сложный" } as Record<
          string,
          string
        >
      )[level]
    : (
        { easy: "Жеңіл", medium: "Орта", advanced: "Күрделі" } as Record<
          string,
          string
        >
      )[level];
}
export function studentDocument(doc: GenerationDocument) {
  return {
    ...doc,
    tasks: doc.tasks.map((t) => ({
      ...t,
      answerBlocks: [],
      explanationHow: "",
      explanationWhy: "",
      rubric: [],
      verificationCases: [],
      translation: t.translation
        ? {
            ...t.translation,
            answerBlocks: [],
            explanationHow: "",
            explanationWhy: "",
            rubric: [],
          }
        : null,
    })),
  };
}
