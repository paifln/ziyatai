import type { KtpRow } from "../contracts";
import { rowGrade } from "./grades";

/** Quote every cell and prevent spreadsheet formula evaluation in source text. */
function cell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text))
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** An offline copy of ALL current rows, including edits and explicit skip flags. */
export function planCsv(
  rows: readonly KtpRow[],
  grade: number | null,
  locale: "ru" | "kk",
) {
  const ru = locale === "ru";
  const header = ru
    ? [
        "№",
        "Номер урока",
        "Раздел",
        "Четверть",
        "Тема",
        "Цели обучения",
        "Цели урока",
        "Класс",
        "Часы",
        "Дата",
        "Примечания",
        "Дата пропущена",
        "Цели пропущены",
        "Лист источника",
      ]
    : [
        "№",
        "Сабақ нөмірі",
        "Бөлім",
        "Тоқсан",
        "Тақырып",
        "Оқу мақсаттары",
        "Сабақ мақсаттары",
        "Сынып",
        "Сағат",
        "Күн",
        "Ескертпелер",
        "Күн өткізіліп жіберілген",
        "Мақсаттар өткізіліп жіберілген",
        "Түпнұсқа парағы",
      ];
  const yes = ru ? "Да" : "Иә",
    no = ru ? "Нет" : "Жоқ";
  const data = rows.map((row, index) => [
    index + 1,
    row.lessonNumberRaw,
    row.section,
    row.quarter,
    row.topic,
    row.goals,
    row.lessonGoals,
    rowGrade(row, grade),
    row.hours,
    row.dateSkipped ? "" : row.dateRaw,
    row.notes,
    row.dateSkipped ? yes : no,
    row.goalsSkipped ? yes : no,
    row.source.sheet,
  ]);
  // BOM and semicolon delimiter make Cyrillic/Kazakh text convenient in local Excel.
  return (
    "\uFEFF" +
    [header, ...data].map((row) => row.map(cell).join(";")).join("\r\n") +
    "\r\n"
  );
}
