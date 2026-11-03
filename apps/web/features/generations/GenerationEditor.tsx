"use client";
import { Save, Eye, Edit3, ClipboardCheck } from "lucide-react";
import { Jobs } from "../../components/Jobs";
import { RevisionConflict } from "../../components/RevisionConflict";
import { DraftRecovery } from "../../components/DraftRecovery";
import type { GenerationEditorProps } from "./types";
import { useGenerationEditor } from "./useGenerationEditor";
import type { GenerationEditorViewState } from "./view-state";
import { GenerationTaskEditor } from "./GenerationTaskEditor";
import { GenerationPrintPanel } from "./GenerationPrintPanel";
export default function GenerationEditor({
  id,
  t,
  locale,
  jobs,
  profileStyles,
  onError,
  onDirtyChange,
  onSaved,
  refresh,
}: GenerationEditorProps) {
  const props = {
    id,
    t,
    locale,
    jobs,
    profileStyles,
    onError,
    onDirtyChange,
    onSaved,
    refresh,
  };
  const model = useGenerationEditor(props);
  const {
    generation,
    setGeneration,
    document,
    setDocument,
    working,
    setBusy,
    mode,
    setMode,
    setReport,
    regenerationJob,
    dirty,
    setDirty,
    readController,
    readFailed,
    setTeacherReviewed,
    conflict,
    setConflict,
    busy,
    baseline,
    backup,
    loadLatest,
    load,
    save,
  } = model;
  if (!generation)
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
      </div>
    );
  if (!document)
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{generation.title}</h1>
            <p>{t.processing}</p>
          </div>
        </div>
        <Jobs
          locale={locale}
          jobs={jobs.filter((j) => j.resource_id === id)}
          t={t}
          refresh={refresh}
        />
        {generation.status === "failed" && (
          <div className="notice error">
            {t.failed}. {t.retry}
          </div>
        )}
      </>
    );
  const view: GenerationEditorViewState = { ...props, ...model, document };
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
          setGeneration((current: any) => ({
            ...current,
            revision: stored.baseRevision,
            reviewed_at: null,
          }));
          setDocument(stored.draft);
          setReport((current: any) => ({ ...current, stale: true }));
          setTeacherReviewed(false);
          setDirty(true);
          setConflict(true);
        }}
      />
      {conflict && baseline.current && (
        <RevisionConflict
          base={baseline.current}
          local={document}
          locale={locale}
          loadLatest={loadLatest}
          onClose={() => setConflict(false)}
          onResolve={(latest, merged, changed) => {
            readController.current?.abort();
            baseline.current = latest.draft;
            setGeneration((current: any) => ({
              ...current,
              revision: latest.revision,
              status: latest.status,
              reviewed_at: latest.reviewedAt,
              document: latest.draft,
            }));
            setDocument(merged);
            setReport(
              changed
                ? { ...(latest.validation as object), stale: true }
                : latest.validation,
            );
            setDirty(changed);
            setTeacherReviewed(false);
            setConflict(false);
            onError("");
          }}
        />
      )}
      <div className="page-heading">
        <div>
          <span className="small-label">
            {t.editor} · {t.versions} {generation.revision}
          </span>
          <h1 style={{ fontSize: 26, marginTop: 8 }}>{generation.title}</h1>
          <span
            className={`badge ${generation.reviewed_at && !dirty ? "green" : "gold"}`}
          >
            {generation.reviewed_at && !dirty
              ? locale === "ru"
                ? "Одобрено учителем"
                : "Мұғалім мақұлдады"
              : t.draft}
          </span>
          {generation.demo && (
            <div className="notice warning">{t.demoLabel}</div>
          )}
        </div>
        <div className="actions">
          <div
            className="editor-view-switch"
            role="group"
            aria-label={locale === "ru" ? "Вид заданий" : "Тапсырма көрінісі"}
          >
            {(
              [
                {
                  key: "review",
                  label: locale === "ru" ? "Проверка" : "Тексеру",
                  icon: ClipboardCheck,
                },
                {
                  key: "edit",
                  label: locale === "ru" ? "Редактировать" : "Өңдеу",
                  icon: Edit3,
                },
                { key: "print", label: "Макет", icon: Eye },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <button
            className="button primary"
            onClick={save}
            disabled={busy || !dirty}
          >
            <Save size={16} />
            {working ? t.loading : t.save}
          </button>
        </div>
      </div>
      <section
        className="approval-banner"
        aria-label={
          locale === "ru" ? "Подготовка к печати" : "Басып шығаруға дайындау"
        }
      >
        <div className="approval-step complete">
          <span>1</span>
          {locale === "ru" ? "Задания готовы" : "Тапсырмалар дайын"}
        </div>
        <div
          className={`approval-step ${generation.reviewed_at && !dirty ? "complete" : "current"}`}
        >
          <span>2</span>
          {locale === "ru" ? "Проверка учителем" : "Мұғалімнің тексеруі"}
        </div>
        <div
          className={`approval-step ${generation.reviewed_at && !dirty ? "current" : ""}`}
        >
          <span>3</span>
          {locale === "ru" ? "Листы для печати" : "Басып шығару парақтары"}
        </div>
      </section>
      {dirty && (
        <div className="notice warning">
          {locale === "ru"
            ? "Есть несохранённые изменения. Сохраните перед экспортом."
            : "Сақталмаған өзгерістер бар. Экспортқа дейін сақтаңыз."}
        </div>
      )}
      {regenerationJob && (
        <Jobs
          locale={locale}
          t={t}
          jobs={jobs.filter((job) => job.id === regenerationJob)}
          refresh={refresh}
        />
      )}
      <div className="editor-layout">
        <GenerationTaskEditor view={view} />
        <GenerationPrintPanel view={view} />
      </div>
    </>
  );
}
