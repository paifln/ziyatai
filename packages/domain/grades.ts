import type { KtpRow } from "../contracts";

/** Explicit class labels only; curriculum objective codes are not class labels. */
export function gradeFromLabel(label: string): number | null {
  if (/\d\s*[-–]\s*\d{1,2}\s*(?:класс|сынып)/iu.test(label)) return null;
  const explicit =
    label.match(
      /(?:^|[^\p{L}\d])(1[01]|[1-9])\s*[-–]?\s*(?:класс(?:а|ы)?|сынып)(?=$|[^\p{L}])/iu,
    ) ??
    label.match(/(?:класс|сынып)\s*[:№-]?\s*(1[01]|[1-9])(?!\d)/iu) ??
    label.match(/^\s*(1[01]|[1-9])\s*[А-ЯӘҒҚҢӨҰҮҺІA-Z]?\s*$/iu);
  return explicit ? Number(explicit[1]) : null;
}
export function rowGrade(row: KtpRow, fallback: number | null = null) {
  return row.grade ?? gradeFromLabel(row.source.sheet ?? "") ?? fallback;
}
export function planGrades(rows: KtpRow[], fallback: number | null = null) {
  return [
    ...new Set(
      rows
        .map((r) => rowGrade(r, fallback))
        .filter((g): g is number => g !== null),
    ),
  ].sort((a, b) => a - b);
}
