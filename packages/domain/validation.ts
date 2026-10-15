import { GenerationDoc, type GenerationDocument } from "../contracts";
import { assertDocumentBudget } from "./document-budget";
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
  assertDocumentBudget(doc);
  const issues: string[] = [];
  const details: {code:string;taskId:string|null;taskIndex:number|null}[] = [];
  let context: {taskId:string;taskIndex:number}|null = null;
  const issue = (code: string) => {
    issues.push(code);
    details.push({code,taskId:context?.taskId ?? null,taskIndex:context?.taskIndex ?? null});
  };
  const blockText = (blocks: GenerationDocument["tasks"][number]["contentBlocks"]) => blocks.map((b) => b.type === "list" ? b.items.join(" ") : b.type === "table" ? [...b.columns,...b.rows.flat()].join(" ") : b.text).join(" ").trim();
  let arithmeticChecked = 0;
  let unexecutedCases = 0;
  if (
    doc.sourceSnapshotId !== snapshot.id ||
    doc.grade !== snapshot.grade ||
    doc.localeMode !== snapshot.locale
  )
    issue("SNAPSHOT_MISMATCH");
  if (doc.tasks.length !== snapshot.count * 3) issue("TASK_COUNT");
  for (const level of ["easy", "medium", "advanced"])
    if (doc.tasks.filter((t) => t.level === level).length !== snapshot.count)
      issue("LEVEL_COUNT");
  const ids = new Set<string>();
  const conditions = new Set<string>();
  for (const [taskIndex,t] of doc.tasks.entries()) {
    context = {taskId:t.id,taskIndex};
    if (!t.id.trim() || ids.has(t.id)) issue("DUPLICATE_ID");
    ids.add(t.id);
    const condition = blockText(t.contentBlocks).normalize("NFKC").trim().toLowerCase();
    if (conditions.has(condition)) issue("DUPLICATE_TASK");
    conditions.add(condition);
    if (
      !condition ||
      !blockText(t.answerBlocks) ||
      !t.explanationHow.trim() ||
      !t.explanationWhy.trim()
    )
      issue("MISSING_CONTENT");
    if (
      t.points < 1 ||
      t.points > 100 ||
      t.rubric.reduce((s, r) => s + r.points, 0) !== t.points ||
      t.rubric.some((r) => r.points < 0 || !r.criterion.trim())
    )
      issue("POINTS");
    if (t.estimatedMinutes < 1 || t.estimatedMinutes > 120)
      issue("DURATION");
    if (
      !t.objectiveRefs.length ||
      t.objectiveRefs.some((c) => !snapshot.objectiveCodes.includes(c))
    )
      issue("OBJECTIVE_REF");
    if (doc.localeMode === "kk+ru" && !t.translation)
      issue("TRANSLATION_MISSING");
    if (t.translation) {
      if (!blockText(t.translation.contentBlocks) || !blockText(t.translation.answerBlocks) || !t.translation.explanationHow.trim() || !t.translation.explanationWhy.trim() || t.translation.rubric.some((r) => !r.criterion.trim())) issue("TRANSLATION_CONTENT");
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
        issue("TRANSLATION_NUMBERS");
    }
    for (const test of t.verificationCases) {
      const actual = arithmetic(test.input);
      const expected = arithmetic(test.expected);
      if (actual === null || expected === null) {
        unexecutedCases++;
        continue;
      }
      arithmeticChecked++;
      if (Math.abs(actual - expected) > 1e-9) issue("ARITHMETIC_ANSWER");
    }
    if (
      t.translation &&
      (t.translation.rubric.length !== t.rubric.length ||
        t.translation.rubric.some((r, i) => r.points !== t.rubric[i]?.points))
    )
      issue("TRANSLATION_POINTS");
    for (const b of [
      ...t.contentBlocks,
      ...t.answerBlocks,
      ...(t.translation?.contentBlocks ?? []),
      ...(t.translation?.answerBlocks ?? []),
    ]) {
      if (b.text.length > 20000 || b.items.length > 100 || b.rows.length > 200)
        issue("CONTENT_LIMIT");
      if (
        b.type === "table" &&
        (b.columns.length === 0 ||
          b.rows.some((r) => r.length !== b.columns.length))
      )
        issue("TABLE_SHAPE");
    }
  }
  return {
    issues: [...new Set(issues)],
    details: [...new Map(details.map((d) => [d.code+":"+d.taskIndex,d])).values()],
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
