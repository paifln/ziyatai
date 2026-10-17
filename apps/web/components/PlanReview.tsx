"use client";
import { useUnsavedChanges } from "../lib/use-unsaved-changes";
import { useDraftState } from "../lib/use-draft-state";
import { useConfirm } from "./ui/ConfirmProvider";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  ArrowRight,
  Plus,
  Save,
  Check,
  Trash2,
  AlertTriangle,
  Download,
  ChevronDown,
  Split,
  Merge,
  Search,
  CalendarOff,
  Undo2,
} from "lucide-react";
import { api } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
import type { KtpRow } from "../../../packages/contracts";
import { Jobs } from "./Jobs";
import { usePolling } from "../lib/use-polling";
import {
  hasRequiredGoals,
  isAssessmentTopic,
} from "../../../packages/domain/goals";
import { normalizeDate } from "../../../packages/domain/dates";
import { planGrades, rowGrade } from "../../../packages/domain/grades";
import { RevisionConflict, type RevisionSnapshot } from "./RevisionConflict";
import type { PlanDraft } from "../../../packages/contracts/drafts";
import { useServerDraft } from "../lib/use-server-draft";
import { DraftRecovery } from "./DraftRecovery";
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
}: {
  id: string;
  t: Texts;
  locale: UiLocale;
  onError: (s: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onGenerate: () => void;
  jobs: any[];
  refresh: () => Promise<void>;
  onBack: () => void;
}) {
  const confirm = useConfirm();
  const [plan, setPlan] = useState<any>(),
    [rows, setRows] = useState<KtpRow[]>([]),
    [grade, setGrade] = useState<number | null>(null),
    [year, setYear] = useState(""),
    [working, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [quarter, setQuarter] = useState(""),
    [sort, setSort] = useState("original"),
    [showWarnings, setShowWarnings] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const { dirty, setDirty, guard } = useDraftState();
  const readController = useRef<AbortController | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [sheet, setSheet] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const loadedPlan = useRef("");
  const [datesBeforeSkip, setDatesBeforeSkip] = useState<KtpRow[] | null>(null);
  const [conflict, setConflict] = useState(false);
  const busy = working || conflict;
  const baseline = useRef<PlanDraft | undefined>(undefined);
  const draft = useMemo(
    () => ({ rows, grade, schoolYear: year }),
    [rows, grade, year],
  );
  const backup = useServerDraft({
    kind: "ktp",
    resourceId: id,
    revision: plan?.revision,
    draft,
    dirty,
    enabled: !busy,
  });
  const loadLatest = useCallback(
    async (signal: AbortSignal): Promise<RevisionSnapshot<PlanDraft>> => {
      const p = await api(`ktp/${id}`, "GET", undefined, undefined, signal);
      return {
        revision: p.revision,
        status: p.status,
        draft: {
          rows: p.rows ?? [],
          grade: p.grade,
          schoolYear: p.school_year ?? "",
        },
      };
    },
    [id],
  );
  const load = useCallback(
    async (savedDraft = false) => {
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const checkpoint = guard.checkpoint();
      try {
        const p = await api(
          `ktp/${id}`,
          "GET",
          undefined,
          undefined,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          !guard.canReplace(checkpoint, savedDraft)
        )
          return;
        setPlan(p);
        baseline.current = {
          rows: p.rows ?? [],
          grade: p.grade,
          schoolYear: p.school_year ?? "",
        };
        setRows(p.rows ?? []);
        setGrade(p.grade);
        if (loadedPlan.current !== id) {
          setClassFilter(p.grade ? String(p.grade) : "");
          setSheet("");
          loadedPlan.current = id;
        }
        setYear(p.school_year ?? "");
        setDatesBeforeSkip(null);
        setDirty(false);
      } catch (e) {
        if (!controller.signal.aborted) onError((e as Error).message);
      }
    },
    [id, onError, guard, setDirty],
  );
  useEffect(() => {
    void load();
    return () => readController.current?.abort();
  }, [load]);
  usePolling(load, plan?.status === "extracting");
  useUnsavedChanges(dirty, onDirtyChange);

  function update(index: number, key: keyof KtpRow, value: string) {
    setRows(
      rows.map((r, i) =>
        i === index
          ? {
              ...r,
              [key]: value,
              ...(key === "dateRaw"
                ? {
                    dateSkipped: false,
                    ...normalizeDate(value),
                    warnings: [
                      ...r.warnings.filter((w) => !w.includes("date")),
                      ...normalizeDate(value).warnings,
                    ],
                  }
                : {}),
              ...(key === "goals"
                ? {
                    goalsSkipped: false,
                    objectiveCodes:
                      value.match(/\b\d{1,2}\.\d+\.\d+\.\d+\b/g) ?? [],
                  }
                : {}),
              source: { ...r.source, method: "manual", confidence: 0.5 },
            }
          : r,
      ),
    );
    setDirty(true);
  }
  function add(after?: number) {
    setQuery("");
    setQuarter("");
    setSort("original");
    const following = after === undefined ? undefined : rows[after];
    const inheritedGrade = following
      ? rowGrade(following, grade)
      : classFilter && classFilter !== "unknown"
        ? Number(classFilter)
        : classFilter === "unknown"
          ? null
          : grade;
    const inheritedSheet = following?.source.sheet ?? (sheet || null);
    const matching = rows.filter(
      (r) =>
        (!sheet || r.source.sheet === sheet) &&
        (!classFilter ||
          String(rowGrade(r, grade) ?? "unknown") === classFilter),
    );
    const position = following
      ? matching.findIndex((r) => r.id === following.id) + 1
      : matching.length;
    setPage(Math.floor(position / 25));
    const r: KtpRow = {
      id: crypto.randomUUID(),
      grade: inheritedGrade,
      sourceOrder: rows.length + 1,
      lessonNumberRaw: "",
      section: "",
      quarter: "",
      topic: "",
      goals: "",
      objectiveCodes: [],
      lessonGoals: "",
      hours: "",
      dateRaw: "",
      dateStart: null,
      dateEnd: null,
      notes: "",
      warnings: [],
      source: {
        page: null,
        sheet: inheritedSheet,
        range: "manual",
        fragment: "",
        method: "manual",
        confidence: 0.5,
      },
    };
    const copy = [...rows];
    copy.splice(after === undefined ? copy.length : after + 1, 0, r);
    setRows(copy);
    setDirty(true);
  }
  async function save(confirm = false) {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api(
        `ktp/${id}/${confirm ? "confirm" : "rows"}`,
        confirm ? "POST" : "PATCH",
        { revision: plan.revision, rows, grade, schoolYear: year },
      );
      // The write is committed even if the following read fails.
      setPlan((current: any) => ({
        ...current,
        revision: saved.revision,
        status: confirm ? "confirmed" : "review",
      }));
      setDirty(false);
      baseline.current = { rows, grade, schoolYear: year };
      await load();
      onSaved();
    } catch (e) {
      if ((e as { code?: string }).code === "CONFLICT") setConflict(true);
      else onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!plan)
    return (
      <div className="inline-loading">
        <span className="spinner" /> {t.loading}
        <button className="button secondary" onClick={onBack}>
          {t.cancel}
        </button>
      </div>
    );
  const related = jobs.filter((j) => j.resource_id === id);
  if (!plan.rows)
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{plan.title}</h1>
            <p>{t.importing}</p>
          </div>
        </div>
        <Jobs
          t={t}
          locale={locale}
          jobs={related}
          refresh={async () => {
            await load();
            await refresh();
          }}
        />
        <button
          className="button secondary mt-20"
          onClick={async () => {
            try {
              for (const job of related.filter((j) =>
                ["queued", "running"].includes(j.status),
              ))
                await api(`jobs/${job.id}/cancel`, "POST", {});
              await refresh();
              onBack();
            } catch (e) {
              onError((e as Error).message);
            }
          }}
        >
          {locale === "ru"
            ? "Отменить и вернуться к планам"
            : "Бас тарту және жоспарларға оралу"}
        </button>
        {["failed", "cancelled"].includes(plan.status) && (
          <div className="notice error">
            {t.failed}.{" "}
            {locale === "ru"
              ? "Загрузите исправленную копию файла."
              : "Түзетілген файл көшірмесін жүктеңіз."}
          </div>
        )}
      </>
    );
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
          {plan.file_id && (
            <a
              className="button secondary"
              href={`/api/uploads/${plan.file_id}`}
            >
              <Download size={16} />
              {t.sourceDownload}
            </a>
          )}
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
            {previewFailed ? (
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
                  const previous = new Map(
                    datesBeforeSkip.map((r) => [r.id, r]),
                  );
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
              {datesBeforeSkip ? (
                <Undo2 size={15} />
              ) : (
                <CalendarOff size={15} />
              )}
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
              disabled={
                busy ||
                (!grade && rows.some((r) => !rowGrade(r))) ||
                !rows.length ||
                rows.some((r) => !r.topic.trim() || !hasRequiredGoals(r))
              }
            >
              <Check size={16} />
              {t.confirm}
            </button>
          </div>
          {rows.some((r) => r.warnings.length) && (
            <div className="notice warning">{t.missing}</div>
          )}
          {!rows.length && <div className="notice warning">{t.noRows}</div>}
        </section>
        <section className="card">
          <div className="toolbar">
            <label className="search-field">
              <span className="sr-only">{t.search}</span>
              <Search size={16} />
              <input
                placeholder={t.search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              <span className="sr-only">{t.quarter}</span>
              <select
                value={quarter}
                onChange={(e) => {
                  setQuarter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">
                  {t.quarter}: {t.all}
                </option>
                {quarterOptions.map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t.sort}</span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(0);
                }}
              >
                <option value="original">{t.originalOrder}</option>
                <option value="date">{t.dateOrder}</option>
              </select>
            </label>
          </div>
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
                  <tr key={r.id}>
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
                        onChange={(e) =>
                          update(index, "dateRaw", e.target.value)
                        }
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
                            onChange={(e) =>
                              update(index, "section", e.target.value)
                            }
                          />
                        </label>
                        <label className="mt-20">
                          {t.quarter}
                          <input
                            value={r.quarter}
                            onChange={(e) =>
                              update(index, "quarter", e.target.value)
                            }
                          />
                        </label>
                        <label className="mt-20">
                          {t.notes}
                          <textarea
                            value={r.notes}
                            onChange={(e) =>
                              update(index, "notes", e.target.value)
                            }
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
          {visible.length > 25 && (
            <nav
              className="pagination"
              aria-label={locale === "ru" ? "Страницы КТП" : "КТЖ беттері"}
            >
              <button
                className="button secondary"
                disabled={currentPage === 0}
                onClick={() => setPage(Math.max(0, currentPage - 1))}
              >
                {t.back}
              </button>
              <span>
                {currentPage + 1} / {Math.ceil(visible.length / 25)} ·{" "}
                {visible.length} {locale === "ru" ? "строк" : "жол"}
              </span>
              <button
                className="button secondary"
                disabled={(currentPage + 1) * 25 >= visible.length}
                onClick={() => setPage(currentPage + 1)}
              >
                {locale === "ru" ? "Далее" : "Келесі"}
              </button>
            </nav>
          )}
          <button className="button secondary mt-20" onClick={() => add()}>
            <Plus size={16} />
            {t.addRow}
          </button>
        </section>
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
