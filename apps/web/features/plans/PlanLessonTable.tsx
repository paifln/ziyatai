"use client";
import {
  Check,
  Trash2,
  AlertTriangle,
  ChevronDown,
  Split,
  Merge,
} from "lucide-react";
import { isAssessmentTopic } from "../../../../packages/domain/goals";
import { rowGrade } from "../../../../packages/domain/grades";
import type { PlanReviewViewState } from "./view-state";
export function PlanLessonTable({ view }: { view: PlanReviewViewState }) {
  const {
    t,
    locale,
    rows,
    setRows,
    grade,
    setPreviewPage,
    setDirty,
    setPreviewFailed,
    setFocusedRow,
    issues,
    update,
    add,
    pageRows,
    warning,
  } = view;
  return (
    <div className="table-scroll">
      <table className="ktp-table">
        <thead>
          <tr>
            <th>{t.number}</th>
            <th>{t.date}</th>
            <th>{t.topic}</th>
            <th>{t.goals}</th>
            <th>{t.hours}</th>
            <th>{t.source}</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map(({ r, index }) => (
            <tr
              key={r.id}
              id={`ktp-row-${r.id}`}
              onFocusCapture={() => setFocusedRow(r.id)}
              onBlurCapture={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setFocusedRow("");
              }}
            >
              <td data-label={t.number}>
                <input
                  aria-label={`${t.number} ${index + 1}`}
                  value={r.lessonNumberRaw}
                  onChange={(e) =>
                    update(index, "lessonNumberRaw", e.target.value)
                  }
                  style={{ minWidth: 45, maxWidth: 55 }}
                />
              </td>
              <td data-label={t.date}>
                <input
                  aria-label={`${t.date} ${index + 1}`}
                  value={r.dateRaw}
                  disabled={r.dateSkipped}
                  onChange={(e) => update(index, "dateRaw", e.target.value)}
                  placeholder="—"
                />
                <button
                  type="button"
                  className="text-button"
                  aria-pressed={!!r.dateSkipped}
                  title={
                    locale === "ru"
                      ? "Оставить дату этого урока пустой. Дату можно добавить позже."
                      : "Осы сабақтың күнін бос қалдыру. Күнді кейін қосуға болады."
                  }
                  onClick={() => {
                    setRows(
                      rows.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              dateSkipped: !row.dateSkipped,
                              dateRaw: "",
                              dateStart: null,
                              dateEnd: null,
                              warnings: row.warnings.filter(
                                (w) => !w.includes("date"),
                              ),
                            }
                          : row,
                      ),
                    );
                    setDirty(true);
                  }}
                  disabled={!r.dateSkipped && !!r.dateRaw.trim()}
                >
                  {r.dateSkipped
                    ? locale === "ru"
                      ? "Без даты · изменить"
                      : "Күнсіз · өзгерту"
                    : locale === "ru"
                      ? "Пропустить"
                      : "Өткізу"}
                </button>
                {r.warnings
                  .filter((w) => w.includes("date"))
                  .map((w) => (
                    <div key={w} className="source-warning">
                      <AlertTriangle size={12} />
                      {warning(w)}
                    </div>
                  ))}
              </td>
              <td data-label={t.topic} className="topic-cell">
                <textarea
                  aria-label={`${t.topic} ${index + 1}`}
                  data-review-field="topic"
                  aria-invalid={!r.topic.trim()}
                  value={r.topic}
                  maxLength={2000}
                  onChange={(e) => update(index, "topic", e.target.value)}
                />
                <details className="row-details">
                  <summary>
                    {t.section} / {t.notes}
                  </summary>
                  <label>
                    {t.grade}
                    <select
                      aria-label={`${t.grade} · ${index + 1}`}
                      data-review-field="grade"
                      aria-invalid={!rowGrade(r, grade)}
                      value={r.grade ?? ""}
                      onChange={(e) => {
                        setRows(
                          rows.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  grade: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                }
                              : row,
                          ),
                        );
                        setDirty(true);
                      }}
                    >
                      <option value="">
                        {locale === "ru" ? "По умолчанию" : "Әдепкі"}
                      </option>
                      {Array.from({ length: 11 }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.section}
                    <input
                      value={r.section}
                      onChange={(e) => update(index, "section", e.target.value)}
                    />
                  </label>
                  <label className="mt-20">
                    {t.quarter}
                    <input
                      value={r.quarter}
                      onChange={(e) => update(index, "quarter", e.target.value)}
                    />
                  </label>
                  <label className="mt-20">
                    {t.notes}
                    <textarea
                      value={r.notes}
                      onChange={(e) => update(index, "notes", e.target.value)}
                    />
                  </label>
                  <label className="mt-20">
                    {t.lessonGoals}
                    <textarea
                      value={r.lessonGoals}
                      onChange={(e) =>
                        update(index, "lessonGoals", e.target.value)
                      }
                    />
                  </label>
                </details>
              </td>
              <td data-label={t.goals} className="goal-cell">
                <textarea
                  aria-label={`${t.goals} ${index + 1}`}
                  data-review-field="goals"
                  aria-invalid={issues.some(
                    (issue) =>
                      issue.id === r.id && issue.fields.includes("goals"),
                  )}
                  disabled={r.goalsSkipped && isAssessmentTopic(r.topic)}
                  value={r.goals}
                  maxLength={8000}
                  onChange={(e) => update(index, "goals", e.target.value)}
                />
                {isAssessmentTopic(r.topic) && (
                  <button
                    type="button"
                    className="text-button"
                    aria-pressed={!!r.goalsSkipped}
                    title={
                      locale === "ru"
                        ? "Для СОР/СОЧ можно пропустить цели. Исходный текст сохранится."
                        : "БЖБ/ТЖБ үшін мақсаттарды өткізуге болады. Бастапқы мәтін сақталады."
                    }
                    onClick={() => {
                      setRows(
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, goalsSkipped: !row.goalsSkipped }
                            : row,
                        ),
                      );
                      setDirty(true);
                    }}
                  >
                    <Check size={13} />
                    {locale === "ru"
                      ? r.goalsSkipped
                        ? "Цели пропущены · вернуть"
                        : "Без целей · СОР/СОЧ"
                      : r.goalsSkipped
                        ? "Мақсаттар өткізілді · қайтару"
                        : "Мақсатсыз · БЖБ/ТЖБ"}
                  </button>
                )}
                {r.warnings
                  .filter(
                    (w) =>
                      !w.includes("date") &&
                      !(
                        r.goalsSkipped &&
                        isAssessmentTopic(r.topic) &&
                        [
                          "missing_objective_text",
                          "objective_code_only",
                        ].includes(w)
                      ),
                  )
                  .map((w) => (
                    <div key={w} className="source-warning">
                      <AlertTriangle size={12} />
                      {warning(w)}
                    </div>
                  ))}
              </td>
              <td data-label={t.hours}>
                <input
                  aria-label={`${t.hours} ${index + 1}`}
                  value={r.hours}
                  onChange={(e) => update(index, "hours", e.target.value)}
                  style={{ minWidth: 45, maxWidth: 55 }}
                />
              </td>
              <td data-label={t.source}>
                <details className="row-details">
                  <summary>
                    {r.source.sheet ||
                      (r.source.page
                        ? `${locale === "ru" ? "Стр." : "Бет"} ${r.source.page}`
                        : t.source)}{" "}
                    <ChevronDown
                      size={12}
                      style={{ verticalAlign: "middle" }}
                    />
                  </summary>
                  {r.source.page && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setPreviewFailed(false);
                        setPreviewPage(r.source.page!);
                      }}
                    >
                      {locale === "ru"
                        ? "Показать оригинальную страницу"
                        : "Түпнұсқа бетті көрсету"}
                    </button>
                  )}
                  <p>{r.source.range}</p>
                  <p>{r.source.fragment || "—"}</p>
                  <small>
                    {r.source.method === "ocr"
                      ? "OCR"
                      : r.source.method === "manual"
                        ? locale === "ru"
                          ? "Ручная редакция"
                          : "Қолмен өңдеу"
                        : locale === "ru"
                          ? "Цифровой файл"
                          : "Цифрлық файл"}
                  </small>
                </details>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={t.split}
                    title={t.split}
                    onClick={() => add(index)}
                  >
                    <Split size={14} />
                  </button>
                  {index < rows.length - 1 && (
                    <button
                      className="icon-button"
                      aria-label={t.merge}
                      title={t.merge}
                      onClick={() => {
                        const next = rows[index + 1];
                        setRows(
                          rows.flatMap((row, i) =>
                            i === index
                              ? [
                                  {
                                    ...row,
                                    topic: `${row.topic}\n${next.topic}`,
                                    goals: `${row.goals}\n${next.goals}`,
                                    objectiveCodes: [
                                      ...row.objectiveCodes,
                                      ...next.objectiveCodes,
                                    ],
                                    notes: `${row.notes}\n${next.notes}`,
                                    warnings: [
                                      ...row.warnings,
                                      ...next.warnings,
                                    ],
                                    source: {
                                      ...row.source,
                                      method: "manual" as const,
                                      fragment: `${row.source.fragment}\n${next.source.fragment}`,
                                    },
                                  },
                                ]
                              : i === index + 1
                                ? []
                                : [row],
                          ),
                        );
                        setDirty(true);
                      }}
                    >
                      <Merge size={14} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    onClick={() => {
                      setRows(rows.filter((_, i) => i !== index));
                      setDirty(true);
                    }}
                    aria-label={t.remove}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
