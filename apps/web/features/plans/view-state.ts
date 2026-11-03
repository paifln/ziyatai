import type { PlanReviewModel } from "./usePlanReview";
import type { PlanReviewProps } from "./types";
import { rowGrade } from "../../../../packages/domain/grades";
export function createPlanReviewView(
  model: PlanReviewModel,
  props: PlanReviewProps,
) {
  const {
    rows,
    grade,
    query,
    quarter,
    sort,
    page,
    sheet,
    classFilter,
    onlyIncomplete,
    focusedRow,
    incomplete,
  } = model;
  const { id, t, locale, jobs } = props;
  const related = jobs.filter((j) => j.resource_id === id);
  const quarterOptions = [
    ...new Set(rows.map((r) => r.quarter).filter(Boolean)),
  ];
  const sheets = [
    ...new Set(rows.map((r) => r.source.sheet).filter(Boolean)),
  ] as string[];
  const visible = rows
    .map((r, index) => ({ r, index }))
    .filter(
      ({ r }) =>
        (r.topic + " " + r.goals + " " + r.section)
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!quarter || r.quarter === quarter) &&
        (!sheet || r.source.sheet === sheet) &&
        (!onlyIncomplete || incomplete.has(r.id) || focusedRow === r.id) &&
        (!classFilter ||
          String(rowGrade(r, grade) ?? "unknown") === classFilter),
    )
    .sort((a, b) =>
      sort === "date"
        ? (a.r.dateStart || "9999").localeCompare(b.r.dateStart || "9999") ||
          a.index - b.index
        : a.index - b.index,
    );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / 25) - 1),
  );
  const pageRows = visible.slice(currentPage * 25, (currentPage + 1) * 25);
  const warning = (w: string) =>
    (
      ({
        missing_date:
          locale === "ru" ? "Дата не указана" : "Күні көрсетілмеген",
        date_requires_year_or_review:
          locale === "ru"
            ? "Уточните год или диапазон даты"
            : "Жылды немесе күн аралығын нақтылаңыз",
        invalid_date:
          locale === "ru"
            ? "Такой календарной даты нет"
            : "Мұндай күнтізбелік күн жоқ",
        invalid_date_range:
          locale === "ru"
            ? "Конец диапазона раньше начала"
            : "Аралықтың соңы басынан бұрын тұр",
        multiple_dates_require_review:
          locale === "ru"
            ? "Указано больше двух дат: проверьте диапазон"
            : "Екі күннен көп көрсетілген: аралықты тексеріңіз",
        missing_objective_text:
          locale === "ru" ? "Нет текста цели" : "Мақсат мәтіні жоқ",
        objective_code_only:
          locale === "ru"
            ? "Указан только код: добавьте текст цели"
            : "Тек код берілген: мақсат мәтінін қосыңыз",
        ocr_requires_review:
          locale === "ru"
            ? "Строка распознана OCR: сверяйте с оригиналом"
            : "OCR арқылы танылған: түпнұсқамен салыстырыңыз",
      }) as Record<string, string>
    )[w] ?? t.warningCode;
  return {
    ...props,
    ...model,
    related,
    quarterOptions,
    sheets,
    visible,
    currentPage,
    pageRows,
    warning,
  };
}
export type PlanReviewViewState = ReturnType<typeof createPlanReviewView>;
