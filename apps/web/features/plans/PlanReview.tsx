"use client";
import { ArrowRight, ChevronDown } from "lucide-react";
import { PlanSchedule } from "../../components/plans/PlanSchedule";
import { DownloadPlanCsv } from "../../components/plans/DownloadPlanCsv";
import { planGrades, rowGrade } from "../../../../packages/domain/grades";
import { RevisionConflict } from "../../components/RevisionConflict";
import { DraftRecovery } from "../../components/DraftRecovery";
import { SourceAccess } from "../../components/SourceAccess";
import type { PlanReviewProps } from "./types";
import { usePlanReview } from "./usePlanReview";
import { createPlanReviewView } from "./view-state";
import { PlanSettings } from "./PlanSettings";
import { PlanLessons } from "./PlanLessons";
export default function PlanReview({
  id,
  t,
  locale,
  onError,
  onDirtyChange,
  onSaved,
  onGenerate,
  jobs,
  refresh,
  onBack,
}: PlanReviewProps) {
  const props = {
    id,
    t,
    locale,
    onError,
    onDirtyChange,
    onSaved,
    onGenerate,
    jobs,
    refresh,
    onBack,
  };
  const model = usePlanReview(props);
  const {
    confirm,
    plan,
    setPlan,
    rows,
    setRows,
    grade,
    setGrade,
    year,
    setYear,
    working,
    setBusy,
    setQuery,
    setQuarter,
    setSort,
    showWarnings,
    setShowWarnings,
    previewPage,
    setPreviewPage,
    sourceAvailable,
    setSourceAvailable,
    dirty,
    setDirty,
    readController,
    previewFailed,
    setPreviewFailed,
    readFailed,
    setPage,
    sheet,
    setSheet,
    classFilter,
    setClassFilter,
    setDatesBeforeSkip,
    setOnlyIncomplete,
    setFocusIssue,
    conflict,
    setConflict,
    busy,
    baseline,
    backup,
    loadLatest,
    load,
  } = model;
  if (!plan)
    return (
      <div className="inline-loading">
        {readFailed ? (
          <button
            className="button secondary"
            onClick={() => {
              onError("");
              void load();
            }}
          >
            {t.retry}
          </button>
        ) : (
          <>
            <span className="spinner" /> {t.loading}
          </>
        )}
        <button className="button secondary" onClick={onBack}>
          {t.cancel}
        </button>
      </div>
    );

  const view = createPlanReviewView(model, props);
  const { sheets } = view;
  return (
    <>
      <DraftRecovery
        controller={backup}
        dirty={dirty}
        disabled={busy}
        locale={locale}
        onBusyChange={setBusy}
        onRestore={(stored) => {
          readController.current?.abort();
          baseline.current = stored.base;
          setPlan((current: any) => ({
            ...current,
            revision: stored.baseRevision,
          }));
          setRows(stored.draft.rows);
          setGrade(stored.draft.grade);
          setYear(stored.draft.schoolYear);
          setDatesBeforeSkip(null);
          setClassFilter("");
          setSheet("");
          setQuery("");
          setQuarter("");
          setPage(0);
          setSort("original");
          setDirty(true);
          setConflict(true);
        }}
      />
      {conflict && baseline.current && (
        <RevisionConflict
          base={baseline.current}
          local={{ rows, grade, schoolYear: year }}
          locale={locale}
          loadLatest={loadLatest}
          onClose={() => setConflict(false)}
          onResolve={(latest, merged, changed) => {
            readController.current?.abort();
            baseline.current = latest.draft;
            setPlan((current: any) => ({
              ...current,
              revision: latest.revision,
              status: latest.status,
              rows: latest.draft.rows,
              grade: latest.draft.grade,
              school_year: latest.draft.schoolYear,
            }));
            setRows(merged.rows);
            setGrade(merged.grade);
            setYear(merged.schoolYear);
            setDatesBeforeSkip(null);
            setClassFilter("");
            setSheet("");
            setQuery("");
            setQuarter("");
            setPage(0);
            setSort("original");
            setDirty(changed);
            setConflict(false);
            onError("");
          }}
        />
      )}
      <div className="page-heading">
        <div>
          <span className="small-label">
            {t.plans} · {t.versions} {plan.revision}
          </span>
          <h1 style={{ fontSize: 26, marginTop: 8 }}>{plan.title}</h1>
          <span
            className={`badge ${plan.status === "confirmed" ? "green" : "gold"}`}
          >
            {plan.status === "confirmed" && !dirty ? t.confirmed : t.review}
          </span>
          {dirty && (
            <span className="status-bar" style={{ marginLeft: 12 }}>
              {locale === "ru"
                ? "Есть несохранённые изменения"
                : "Сақталмаған өзгерістер бар"}
            </span>
          )}
        </div>
        <div className="actions">
          <DownloadPlanCsv
            rows={rows}
            grade={grade}
            locale={locale}
            disabled={working}
          />
          <button
            className="button primary"
            disabled={plan.status !== "confirmed" || dirty}
            onClick={onGenerate}
          >
            {t.create}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      {plan.file_id && (
        <SourceAccess
          key={plan.file_id}
          planId={id}
          uploadId={plan.file_id}
          locale={locale}
          onAvailability={setSourceAvailable}
        />
      )}
      {rows.length > 0 && (
        <section className="sheet-picker card">
          <label>
            {locale === "ru" ? "Показать класс" : "Сыныпты көрсету"}
            <select
              aria-label={
                locale === "ru" ? "Показать класс" : "Сыныпты көрсету"
              }
              value={classFilter}
              onChange={(e) => {
                setClassFilter(e.target.value);
                setSheet("");
                setPage(0);
              }}
            >
              <option value="">
                {locale === "ru" ? "Все классы" : "Барлық сыныптар"} ·{" "}
                {rows.length}
              </option>
              {planGrades(rows, grade).map((g) => (
                <option key={g} value={g}>
                  {g} · {rows.filter((r) => rowGrade(r, grade) === g).length}
                </option>
              ))}
              {rows.some((r) => !rowGrade(r, grade)) && (
                <option value="unknown">
                  {locale === "ru"
                    ? "Класс не определён"
                    : "Сынып анықталмаған"}
                </option>
              )}
            </select>
          </label>
          <p className="muted">
            {locale === "ru"
              ? "Фильтр не удаляет уроки других классов. Порядок уроков внутри класса сохраняется."
              : "Сүзгі басқа сыныптардың сабақтарын жоймайды. Сабақ реті сақталады."}
          </p>
        </section>
      )}
      {sheets.length > 1 && (
        <section className="sheet-picker card">
          <label>
            {locale === "ru" ? "Лист / класс" : "Парақ / сынып"}
            <select
              aria-label={locale === "ru" ? "Лист / класс" : "Парақ / сынып"}
              disabled={busy}
              value={sheet}
              onChange={(e) => {
                setSheet(e.target.value);
                setPage(0);
              }}
            >
              <option value="">
                {locale === "ru"
                  ? `Все листы · ${rows.length} уроков`
                  : `Барлық парақтар · ${rows.length} сабақ`}
              </option>
              {sheets.map((name) => (
                <option key={name} value={name}>
                  {name} · {rows.filter((r) => r.source.sheet === name).length}
                </option>
              ))}
            </select>
          </label>
          {sheet && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirm(
                    locale === "ru"
                      ? "Оставить в этом плане только выбранный лист? Исходный Excel сохранится целиком."
                      : "Осы жоспарда тек таңдалған парақты қалдыру керек пе? Бастапқы Excel толық сақталады.",
                  ))
                )
                  return;
                setRows(rows.filter((r) => r.source.sheet === sheet));
                const detected = sheet.match(/^\s*(1[01]|[1-9])(?:\D|$)/);
                if (detected) setGrade(Number(detected[1]));
                setDirty(true);
                setPage(0);
              }}
            >
              {locale === "ru"
                ? "Работать только с этим листом"
                : "Тек осы парақпен жұмыс істеу"}
            </button>
          )}
        </section>
      )}
      {!rows.length && (
        <div className="notice warning">
          <p>
            {locale === "ru"
              ? "Уроки не распознаны. Можно выбрать другой файл или восстановить строки вручную ниже."
              : "Сабақтар танылмады. Басқа файлды таңдаңыз немесе төменде жолдарды қолмен қосыңыз."}
          </p>
          <button className="button secondary" onClick={onBack}>
            {locale === "ru" ? "Вернуться к планам" : "Жоспарларға оралу"}
          </button>
        </div>
      )}
      <fieldset className="editor-fields" disabled={busy}>
        <legend className="sr-only">{t.plans}</legend>
        {previewPage > 0 && (
          <section className="card source-preview">
            <div className="card-heading">
              <h2>
                {t.source} · {locale === "ru" ? "Страница" : "Бет"}{" "}
                {previewPage}
              </h2>
              <button className="text-button" onClick={() => setPreviewPage(0)}>
                {t.cancel}
              </button>
            </div>
            {!sourceAvailable ? (
              <p className="notice warning">
                {locale === "ru"
                  ? "Проверьте доступность исходника в блоке файла выше."
                  : "Жоғарыдағы файл бөлімінде бастапқы файлдың қолжетімділігін тексеріңіз."}
              </p>
            ) : previewFailed ? (
              <p className="notice warning">
                {locale === "ru"
                  ? "Предпросмотр недоступен. Скачайте исходник, чтобы проверить страницу."
                  : "Алдын ала қарау қолжетімсіз. Бетті тексеру үшін бастапқы файлды жүктеңіз."}
              </p>
            ) : (
              <img
                onError={() => setPreviewFailed(true)}
                src={`/api/ktp/${id}/preview?page=${previewPage}`}
                alt={`${t.source} ${previewPage}`}
                style={{ maxWidth: "100%", height: "auto" }}
              />
            )}
          </section>
        )}
        <PlanSettings view={view} />
        <PlanSchedule
          rows={rows}
          grade={grade}
          classFilter={classFilter}
          locale={locale}
          disabled={busy}
          onOpen={(rowId) => {
            const index = rows.findIndex((row) => row.id === rowId);
            if (index < 0) return;
            setOnlyIncomplete(false);
            setQuery("");
            setQuarter("");
            setSheet("");
            setClassFilter("");
            setSort("original");
            setPage(Math.floor(index / 25));
            setFocusIssue({ id: rowId, field: "topic" });
          }}
        />
        <PlanLessons view={view} />
        {plan.unrecognized?.length > 0 && (
          <section className="card">
            <button
              className="text-button"
              onClick={() => setShowWarnings(!showWarnings)}
            >
              {t.unrecognized} ({plan.unrecognized.length}){" "}
              <ChevronDown size={14} style={{ verticalAlign: "middle" }} />
            </button>
            {showWarnings &&
              plan.unrecognized.map((s: string, i: number) => (
                <p
                  key={i}
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    marginTop: 16,
                  }}
                >
                  {s}
                </p>
              ))}
          </section>
        )}
      </fieldset>
    </>
  );
}
