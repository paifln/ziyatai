"use client";
import { Save, Check, CalendarOff, Undo2 } from "lucide-react";
import { PlanReadiness } from "../../components/plans/PlanReadiness";
import { planGrades } from "../../../../packages/domain/grades";
import type { PlanReviewViewState } from "./view-state";
export function PlanSettings({ view }: { view: PlanReviewViewState }) {
  const {
    t,
    locale,
    confirm,
    rows,
    setRows,
    grade,
    setGrade,
    year,
    setYear,
    setQuery,
    setQuarter,
    setSort,
    setDirty,
    setPage,
    setSheet,
    setClassFilter,
    datesBeforeSkip,
    setDatesBeforeSkip,
    onlyIncomplete,
    setOnlyIncomplete,
    setFocusedRow,
    setFocusIssue,
    issues,
    busy,
    save,
  } = view;
  return (
    <section className="card">
      <div className="plan-settings">
        <label>
          {t.grade}
          <select
            aria-label={t.grade}
            value={grade ?? ""}
            onChange={(e) => {
              setGrade(e.target.value ? Number(e.target.value) : null);
              if (planGrades(rows, grade).length <= 1) {
                setRows(
                  rows.map((r) => ({
                    ...r,
                    grade: e.target.value ? Number(e.target.value) : null,
                  })),
                );
                setClassFilter(e.target.value);
              }
              setDirty(true);
            }}
          >
            <option value="">{t.select}</option>
            {Array.from({ length: 11 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.year}
          <input
            value={year}
            placeholder="2026–2027"
            maxLength={20}
            onChange={(e) => {
              setYear(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <button
          type="button"
          className="button secondary compact-button"
          title={
            locale === "ru"
              ? "Оставить все уроки без дат, включая строки на других страницах и листах. Изменения сохраняются вместе с КТП."
              : "Барлық беттер мен парақтардағы сабақ күндерін өткізу. Өзгерістер КТЖ-мен бірге сақталады."
          }
          disabled={busy || !rows.length}
          onClick={async () => {
            if (datesBeforeSkip) {
              const previous = new Map(datesBeforeSkip.map((r) => [r.id, r]));
              setRows(
                rows.map((r) => {
                  const old = previous.get(r.id);
                  return old
                    ? {
                        ...r,
                        dateRaw: old.dateRaw,
                        dateStart: old.dateStart,
                        dateEnd: old.dateEnd,
                        dateSkipped: old.dateSkipped,
                        warnings: [
                          ...r.warnings.filter((w) => !w.includes("date")),
                          ...old.warnings.filter((w) => w.includes("date")),
                        ],
                      }
                    : r;
                }),
              );
              setDatesBeforeSkip(null);
            } else {
              if (
                rows.some((r) => r.dateRaw.trim()) &&
                !(await confirm(
                  locale === "ru"
                    ? "Пропустить все даты, включая уже заполненные? До сохранения их можно вернуть одной кнопкой."
                    : "Толтырылған күндерді қоса, барлық күндерді өткізу керек пе? Сақтағанға дейін оларды бір батырмамен қайтаруға болады.",
                ))
              )
                return;
              setDatesBeforeSkip(rows);
              setRows(
                rows.map((r) => ({
                  ...r,
                  dateRaw: "",
                  dateStart: null,
                  dateEnd: null,
                  dateSkipped: true,
                  warnings: r.warnings.filter((w) => !w.includes("date")),
                })),
              );
            }
            setDirty(true);
          }}
        >
          {datesBeforeSkip ? <Undo2 size={15} /> : <CalendarOff size={15} />}
          {datesBeforeSkip
            ? locale === "ru"
              ? "Вернуть даты"
              : "Күндерді қайтару"
            : locale === "ru"
              ? "Пропустить все даты"
              : "Барлық күндерді өткізу"}
        </button>
        <button
          className="button secondary"
          onClick={() => save()}
          disabled={busy}
        >
          <Save size={16} />
          {t.save}
        </button>
        <button
          className="button primary"
          onClick={() => save(true)}
          disabled={busy || !rows.length || issues.length > 0}
        >
          <Check size={16} />
          {t.confirm}
        </button>
      </div>
      {rows.length > 0 && (
        <PlanReadiness
          issues={issues}
          total={rows.length}
          locale={locale}
          filtered={onlyIncomplete}
          onFilter={() => {
            setOnlyIncomplete(!onlyIncomplete);
            setFocusedRow("");
            setQuery("");
            setQuarter("");
            setSheet("");
            setClassFilter("");
            setPage(0);
          }}
          onFirst={() => {
            const first = issues[0];
            if (!first) return;
            setOnlyIncomplete(false);
            setQuery("");
            setQuarter("");
            setSheet("");
            setClassFilter("");
            setSort("original");
            setPage(Math.floor(first.index / 25));
            setFocusIssue({ id: first.id, field: first.fields[0] });
          }}
        />
      )}
      {rows.some((r) => r.warnings.length) && (
        <div className="notice warning">{t.missing}</div>
      )}
      {!rows.length && <div className="notice warning">{t.noRows}</div>}
    </section>
  );
}
