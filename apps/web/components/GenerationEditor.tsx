"use client";
import { useUnsavedChanges } from "../lib/use-unsaved-changes";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  Check,
  Download,
  Save,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Eye,
  Edit3,
  ClipboardCheck,
} from "lucide-react";
import { api } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
import {
  Styles,
  type GenerationDocument,
  type TaskDocument,
} from "../../../packages/contracts";
import {
  displayLevel,
  displayPoints,
} from "../../../packages/domain/validation";
import { validationMessage } from "../../../packages/domain/validation-messages";
import { Jobs } from "./Jobs";
import { usePolling } from "../lib/use-polling";
import TableEditor from "./TableEditor";
import { DisplayBlocks } from "./generations/DisplayBlocks";
import { TaskReview } from "./generations/TaskReview";
type Block = TaskDocument["contentBlocks"][number];
const blank = (type: Block["type"] = "paragraph"): Block => ({
  type,
  text: "",
  items: [],
  columns: [],
  rows: [],
  language: "",
});
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
}: {
  id: string;
  t: Texts;
  locale: UiLocale;
  jobs: any[];
  profileStyles: any;
  onError: (s: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  refresh: () => Promise<void>;
}) {
  const [generation, setGeneration] = useState<any>(),
    [document, setDocument] = useState<GenerationDocument>(),
    [versions, setVersions] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [mode, setMode] = useState<"review" | "edit" | "print">("review"),
    [audience, setAudience] = useState<"full" | "student">("full"),
    [styles, setStyles] = useState(Styles.parse(profileStyles)),
    [exportJobs, setExportJobs] = useState<any[]>([]),
    [report, setReport] = useState<any>();
  const [regenerationJob, setRegenerationJob] = useState("");
  const [activeTask, setActiveTask] = useState("");
  const [teacherReviewed, setTeacherReviewed] = useState(false);
  useEffect(() => {
    setTeacherReviewed(false);
  }, [generation?.revision]);
  useEffect(() => {
    if (dirty) setTeacherReviewed(false);
  }, [dirty]);
  const requestKeys = useRef(new Map<string, string>());
  function requestKey(data: unknown) {
    const signature = JSON.stringify(data);
    if (!requestKeys.current.has(signature))
      requestKeys.current.set(signature, crypto.randomUUID());
    return requestKeys.current.get(signature)!;
  }
  const load = useCallback(async () => {
    try {
      const g = await api(`generations/${id}`);
      setGeneration(g);
      if (g.document) {
        setDocument(g.document);
        setReport(g.validation);
        setVersions(await api(`generations/${id}/versions`));
      }
      setDirty(false);
    } catch (e) {
      onError((e as Error).message);
    }
  }, [id, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  usePolling(load, ["queued", "running"].includes(generation?.status));
  async function refreshExports(all = false) {
    const next = await Promise.all(
      exportJobs
        .filter((job) => all || ["queued", "running"].includes(job.status))
        .map(async (job) => ({ ...job, ...(await api(`jobs/${job.id}`)) })),
    );
    const byId = new Map(next.map((job) => [job.id, job]));
    setExportJobs((current) => current.map((job) => byId.get(job.id) ?? job));
  }
  usePolling(
    async () => {
      try {
        await refreshExports();
      } catch (e) {
        onError((e as Error).message);
      }
    },
    exportJobs.some((j) => ["queued", "running"].includes(j.status)),
  );
  useUnsavedChanges(dirty, onDirtyChange);
  usePolling(async () => {
    try {
      const result = await api(`jobs/${regenerationJob}`);
      if (["succeeded", "failed", "cancelled"].includes(result.status)) {
        setRegenerationJob("");
        setBusy(false);
        if (result.status === "succeeded") {
          await load();
          onSaved();
        } else onError(result.error?.message ?? t.failed);
        await refresh();
      }
    } catch (e) {
      setRegenerationJob("");
      setBusy(false);
      onError((e as Error).message);
    }
  }, !!regenerationJob);

  function changeTask(index: number, update: Partial<TaskDocument>) {
    setDocument({
      ...document!,
      tasks: document!.tasks.map((task, i) =>
        i === index ? { ...task, ...update } : task,
      ),
    });
    setDirty(true);
    setReport({ ...report, stale: true });
  }
  async function save() {
    if (!document) return;
    setBusy(true);
    try {
      await api(`generations/${id}/document`, "PATCH", {
        revision: generation.revision,
        document,
      });
      await load();
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: string) {
    setBusy(true);
    try {
      const data = {
        generationId: id,
        revision: generation.revision,
        format,
        audience,
        styles,
        teacherReviewed: !!generation.reviewed_at && !dirty,
      };
      const result = await api("exports", "POST", data, requestKey(data));
      setExportJobs((current) => [
        ...current.filter((job) => job.id !== result.jobId),
        {
          id: result.jobId,
          status: "queued",
          kind: "export",
          stage: "queued",
          result: { exportId: result.id },
          format,
        },
      ]);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!teacherReviewed || dirty || !document) return;
    setBusy(true);
    try {
      await api(`generations/${id}/approve`, "POST", {
        revision: generation.revision,
        teacherReviewed: true,
      });
      await load();
      onSaved();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function regenerate(task: TaskDocument) {
    if (dirty) return;
    setBusy(true);
    try {
      const j = await api(
        `generations/${id}/tasks/${task.id}/regenerate`,
        "POST",
        { revision: generation.revision },
        requestKey({ taskId: task.id, revision: generation.revision }),
      );
      setRegenerationJob(j.jobId);
      await refresh();
    } catch (e) {
      setBusy(false);
      onError((e as Error).message);
    }
  }
  function editTask(taskId: string) {
    setActiveTask(taskId);
    setMode("edit");
    requestAnimationFrame(() =>
      window.document
        .getElementById(`task-${taskId}`)
        ?.querySelector<HTMLTextAreaElement>("textarea")
        ?.focus(),
    );
  }
  if (!generation)
    return (
      <div className="inline-loading">
        <span className="spinner" /> {t.loading}
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
  return (
    <>
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
            {busy ? t.loading : t.save}
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
        <fieldset className="editor-fields" disabled={busy}>
          <legend className="sr-only">{t.editor}</legend>
          {mode === "review" ? (
            <TaskReview
              document={document}
              t={t}
              locale={locale}
              onEditTask={editTask}
              onRegenerate={!generation.demo && !dirty ? regenerate : undefined}
            />
          ) : mode === "print" ? (
            <Preview
              doc={document}
              snapshot={generation.source_snapshot}
              audience={audience}
              styles={styles}
              t={t}
              onEditTask={editTask}
              onRegenerate={!generation.demo && !dirty ? regenerate : undefined}
            />
          ) : (
            document.tasks.map((task, index) => (
              <section
                className="task-card"
                key={task.id}
                data-expanded={
                  activeTask ? activeTask === task.id : index === 0
                }
              >
                <div className="task-header">
                  <span className="task-number">{index + 1}</span>
                  <button
                    className="task-toggle"
                    aria-expanded={
                      activeTask ? activeTask === task.id : index === 0
                    }
                    aria-controls={`task-${task.id}`}
                    onClick={() =>
                      setActiveTask(
                        (activeTask ? activeTask === task.id : index === 0)
                          ? "closed"
                          : task.id,
                      )
                    }
                  >
                    <strong>{displayLevel(task.level, locale)}</strong>
                    <small>
                      {displayPoints(task.points, locale)} ·{" "}
                      {task.estimatedMinutes} мин
                    </small>
                    <span aria-hidden="true">
                      {(activeTask ? activeTask === task.id : index === 0)
                        ? "−"
                        : "+"}
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t.moveUp}
                    disabled={
                      index === 0 ||
                      document.tasks[index - 1]?.level !== task.level
                    }
                    onClick={() => {
                      const tasks = [...document.tasks];
                      [tasks[index - 1], tasks[index]] = [
                        tasks[index],
                        tasks[index - 1],
                      ];
                      setDocument({ ...document, tasks });
                      setDirty(true);
                    }}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t.moveDown}
                    disabled={
                      index === document.tasks.length - 1 ||
                      document.tasks[index + 1]?.level !== task.level
                    }
                    onClick={() => {
                      const tasks = [...document.tasks];
                      [tasks[index + 1], tasks[index]] = [
                        tasks[index],
                        tasks[index + 1],
                      ];
                      setDocument({ ...document, tasks });
                      setDirty(true);
                    }}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                {(activeTask ? activeTask === task.id : index === 0) ? (
                  <div id={`task-${task.id}`}>
                    <label>{t.condition}</label>
                    <BlocksEditor
                      blocks={task.contentBlocks}
                      onChange={(blocks) =>
                        changeTask(index, { contentBlocks: blocks })
                      }
                      t={t}
                    />
                    <details>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontWeight: 600,
                          color: "var(--green)",
                          marginBottom: 16,
                        }}
                      >
                        {t.answer} · {t.how} · {t.rubric}
                      </summary>
                      <label>{t.answer}</label>
                      <BlocksEditor
                        blocks={task.answerBlocks}
                        onChange={(blocks) =>
                          changeTask(index, { answerBlocks: blocks })
                        }
                        t={t}
                      />
                      <label>
                        {t.how}
                        <textarea
                          value={task.explanationHow}
                          onChange={(e) =>
                            changeTask(index, {
                              explanationHow: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t.why}
                        <textarea
                          value={task.explanationWhy}
                          onChange={(e) =>
                            changeTask(index, {
                              explanationWhy: e.target.value,
                            })
                          }
                        />
                      </label>
                      <div className="form-grid">
                        <label>
                          {t.points}
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={task.points}
                            onChange={(e) =>
                              changeTask(index, {
                                points: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          {t.duration}
                          <input
                            type="number"
                            min={1}
                            max={120}
                            value={task.estimatedMinutes}
                            onChange={(e) =>
                              changeTask(index, {
                                estimatedMinutes: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="mt-20">{t.rubric}</label>
                      {task.rubric.map((r, i) => (
                        <div className="rubric-row" key={i}>
                          <input
                            aria-label={`${t.rubric} ${i + 1}`}
                            value={r.criterion}
                            onChange={(e) =>
                              changeTask(index, {
                                rubric: task.rubric.map((r, j) =>
                                  j === i
                                    ? { ...r, criterion: e.target.value }
                                    : r,
                                ),
                              })
                            }
                          />
                          <input
                            aria-label={`${t.points} ${i + 1}`}
                            type="number"
                            min={0}
                            max={100}
                            value={r.points}
                            onChange={(e) =>
                              changeTask(index, {
                                rubric: task.rubric.map((r, j) =>
                                  j === i
                                    ? { ...r, points: Number(e.target.value) }
                                    : r,
                                ),
                              })
                            }
                          />
                          <button
                            className="icon-button"
                            aria-label={t.remove}
                            onClick={() =>
                              changeTask(index, {
                                rubric: task.rubric.filter((_, j) => j !== i),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="text-button"
                        onClick={() =>
                          changeTask(index, {
                            rubric: [
                              ...task.rubric,
                              { criterion: "", points: 1 },
                            ],
                          })
                        }
                      >
                        <Plus size={13} />
                        {t.rubric}
                      </button>
                    </details>
                    {task.translation && (
                      <details className="mt-20">
                        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                          {locale === "ru" ? "Русская версия" : "Орысша нұсқа"}
                        </summary>
                        <label className="mt-20">{t.condition}</label>
                        <BlocksEditor
                          blocks={task.translation.contentBlocks}
                          onChange={(blocks) =>
                            changeTask(index, {
                              translation: {
                                ...task.translation!,
                                contentBlocks: blocks,
                              },
                            })
                          }
                          t={t}
                        />
                        <label>{t.answer}</label>
                        <BlocksEditor
                          blocks={task.translation.answerBlocks}
                          onChange={(blocks) =>
                            changeTask(index, {
                              translation: {
                                ...task.translation!,
                                answerBlocks: blocks,
                              },
                            })
                          }
                          t={t}
                        />
                        <label>
                          {t.how}
                          <textarea
                            value={task.translation.explanationHow}
                            onChange={(e) =>
                              changeTask(index, {
                                translation: {
                                  ...task.translation!,
                                  explanationHow: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t.why}
                          <textarea
                            value={task.translation.explanationWhy}
                            onChange={(e) =>
                              changeTask(index, {
                                translation: {
                                  ...task.translation!,
                                  explanationWhy: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        {task.translation.rubric.map((r, i) => (
                          <label key={i}>
                            {t.rubric} ({r.points})
                            <input
                              value={r.criterion}
                              onChange={(e) =>
                                changeTask(index, {
                                  translation: {
                                    ...task.translation!,
                                    rubric: task.translation!.rubric.map(
                                      (criterion, j) =>
                                        j === i
                                          ? {
                                              ...criterion,
                                              criterion: e.target.value,
                                            }
                                          : criterion,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </details>
                    )}
                    <div className="actions">
                      <button
                        className="button secondary"
                        disabled={busy || dirty || generation.demo}
                        onClick={() => regenerate(task)}
                      >
                        <RefreshCw size={14} />
                        {t.regenerate}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="task-excerpt">
                    {task.contentBlocks
                      .find((b) => b.type === "paragraph")
                      ?.text.slice(0, 200) ||
                      (locale === "ru"
                        ? "Откройте задание для редактирования"
                        : "Өңдеу үшін тапсырманы ашыңыз")}
                  </p>
                )}
              </section>
            ))
          )}
        </fieldset>
        <aside className="editor-side">
          <section className="card" id="teacher-approval">
            <h2>
              {generation.reviewed_at && !dirty
                ? locale === "ru"
                  ? "Можно печатать"
                  : "Басып шығаруға дайын"
                : locale === "ru"
                  ? "Всё подходит классу?"
                  : "Сыныпқа сәйкес келе ме?"}
            </h2>
            {!generation.reviewed_at && (
              <p className="review-hint">
                {locale === "ru"
                  ? "Прочитайте задания, ответы и критерии. Если нужно — отредактируйте или перегенерируйте отдельное задание. PDF и DOCX станут доступны после вашего одобрения."
                  : "Тапсырмаларды, жауаптар мен критерийлерді оқыңыз. Қажет болса, өңдеңіз немесе жеке тапсырманы қайта жасаңыз. PDF пен DOCX мақұлдағаннан кейін қолжетімді болады."}
              </p>
            )}
            {(!generation.reviewed_at || dirty) && (
              <>
                <label className="checkbox teacher-review">
                  <input
                    type="checkbox"
                    checked={teacherReviewed}
                    disabled={dirty || busy || !!report?.issues?.length}
                    onChange={(e) => setTeacherReviewed(e.target.checked)}
                  />
                  <span>
                    {locale === "ru"
                      ? "Я проверил(а) задания, ответы и критерии"
                      : "Тапсырмаларды, жауаптар мен критерийлерді тексердім"}
                  </span>
                </label>
                <p className="review-hint">
                  {locale === "ru"
                    ? "Одобрение сохранится для этой версии. После изменений нужно проверить задания ещё раз."
                    : "Мақұлдау осы нұсқа үшін сақталады. Өзгерткеннен кейін қайта тексеру қажет."}
                </p>
                <button
                  className="button primary wide"
                  onClick={approve}
                  disabled={
                    !teacherReviewed ||
                    dirty ||
                    busy ||
                    !!report?.issues?.length
                  }
                >
                  <Check size={16} />
                  {locale === "ru"
                    ? "Одобрить задания"
                    : "Тапсырмаларды мақұлдау"}
                </button>
              </>
            )}
            <details
              className="print-options"
              open={!!generation.reviewed_at && !dirty}
            >
              <summary>
                {locale === "ru" ? "Настройки листов" : "Парақ баптаулары"}
              </summary>
              <label>
                {locale === "ru" ? "Вариант" : "Нұсқа"}
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as any)}
                >
                  <option value="full">{t.full}</option>
                  <option value="student">{t.student}</option>
                </select>
              </label>
              <label>
                {locale === "ru" ? "Макет печати" : "Басып шығару макеті"}
                <select
                  value={styles.layout}
                  onChange={(e) =>
                    setStyles({
                      ...styles,
                      layout: e.target.value as
                        "portrait" | "landscape-columns",
                    })
                  }
                >
                  <option value="portrait">
                    {locale === "ru" ? "A4 · книжный" : "A4 · тік"}
                  </option>
                  <option value="landscape-columns">
                    {locale === "ru"
                      ? "A4 · альбомный, две колонки"
                      : "A4 · көлденең, екі баған"}
                  </option>
                </select>
              </label>
              <label>
                {t.font}
                <select
                  value={styles.font}
                  onChange={(e) =>
                    setStyles({ ...styles, font: e.target.value as any })
                  }
                >
                  {[
                    "Times New Roman",
                    "Arial",
                    "Calibri",
                    "Liberation Serif",
                    "Liberation Sans",
                    "Carlito",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  {t.fontSize}
                  <input
                    type="number"
                    min={10}
                    max={18}
                    value={styles.size}
                    onChange={(e) =>
                      setStyles({ ...styles, size: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {t.spacing}
                  <select
                    value={styles.lineSpacing}
                    onChange={(e) =>
                      setStyles({
                        ...styles,
                        lineSpacing: Number(e.target.value) as any,
                      })
                    }
                  >
                    <option value={1}>1</option>
                    <option value={1.15}>1.15</option>
                    <option value={1.5}>1.5</option>
                  </select>
                </label>
              </div>
              <details className="mt-20">
                <summary>{t.margins}</summary>
                <div className="form-grid">
                  {(
                    [
                      "marginLeft",
                      "marginRight",
                      "marginTop",
                      "marginBottom",
                    ] as const
                  ).map((key, i) => (
                    <label key={key}>
                      {[t.left, t.right, t.top, t.bottom][i]}
                      <input
                        type="number"
                        min={1}
                        max={4}
                        step={0.5}
                        value={styles[key]}
                        onChange={(e) =>
                          setStyles({
                            ...styles,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={styles.answerSpace}
                  onChange={(e) =>
                    setStyles({ ...styles, answerSpace: e.target.checked })
                  }
                />
                {t.answerSpace}
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={styles.includeLogo}
                  onChange={(e) =>
                    setStyles({ ...styles, includeLogo: e.target.checked })
                  }
                />
                {t.logo}
              </label>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={busy || dirty || !generation.reviewed_at}
                  onClick={() => exportFile("docx")}
                >
                  <Download size={14} />
                  DOCX
                </button>
                <button
                  className="button secondary"
                  disabled={busy || dirty || !generation.reviewed_at}
                  onClick={() => exportFile("pdf")}
                >
                  <Download size={14} />
                  PDF
                </button>
              </div>
            </details>
            <div className="export-progress" aria-live="polite">
              <Jobs
                jobs={exportJobs}
                t={t}
                locale={locale}
                refresh={async () => {
                  await refreshExports(true);
                  await refresh();
                }}
              />
              {exportJobs
                .filter((job) => job.status === "succeeded")
                .map((job) => (
                  <div key={job.id} className="export-download">
                    <span>{job.format?.toUpperCase()}</span>
                    <a
                      className="text-button"
                      href={`/api/exports/${job.result.exportId}/download`}
                    >
                      {t.download}
                      <Download size={14} />
                    </a>
                  </div>
                ))}
            </div>
          </section>
          <section className="card">
            <h2>{locale === "ru" ? "Автопроверка" : "Автотексеру"}</h2>
            <p style={{ fontSize: 12 }}>{t.teacherWarning}</p>
            {report?.stale && (
              <div className="notice warning">
                {locale === "ru"
                  ? "После изменения задания проверку нужно повторить."
                  : "Тапсырманы өзгерткеннен кейін қайта тексеру қажет."}
              </div>
            )}
            {report?.issues?.length > 0 && (
              <div className="notice warning" role="status">
                {locale === "ru"
                  ? "Есть ошибки структуры, баллов или ссылок на цели. Проверьте отредактированные задания."
                  : "Құрылымда, балдарда немесе мақсат сілтемелерінде қате бар. Өңделген тапсырмаларды тексеріңіз."}
                <ul className="validation-list">
                  {(report.details?.length
                    ? report.details
                    : report.issues.map((code: string) => ({
                        code,
                        taskIndex: null,
                        taskId: null,
                      }))
                  ).map(
                    (
                      detail: {
                        code: string;
                        taskIndex: number | null;
                        taskId: string | null;
                      },
                      i: number,
                    ) => (
                      <li key={i}>
                        {detail.taskId ? (
                          <button
                            className="text-button"
                            onClick={() => {
                              setMode("edit");
                              setActiveTask(detail.taskId!);
                              requestAnimationFrame(() =>
                                window.document
                                  .getElementById(`task-${detail.taskId}`)
                                  ?.scrollIntoView({ block: "center" }),
                              );
                            }}
                          >
                            {locale === "ru" ? "Задание" : "Тапсырма"}{" "}
                            {(detail.taskIndex ?? 0) + 1}:{" "}
                            {validationMessage(detail.code, locale)}
                          </button>
                        ) : (
                          validationMessage(detail.code, locale)
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
            <button
              className="button secondary wide"
              disabled={dirty || busy}
              onClick={async () => {
                try {
                  setReport(
                    await api(`generations/${id}/validate`, "POST", {}),
                  );
                  onSaved();
                } catch (e) {
                  onError((e as Error).message);
                }
              }}
            >
              <Check size={15} />
              {t.validate}
            </button>
          </section>
          <section className="card">
            <h2>{t.versions}</h2>
            <p style={{ fontSize: 11 }}>{t.comparison}</p>
            {versions.map((v) => (
              <div className="version-row" key={v.revision}>
                <span>
                  {v.revision} ·{" "}
                  {new Date(v.created_at).toLocaleDateString(
                    locale === "ru" ? "ru-RU" : "kk-KZ",
                  )}
                </span>
                <button
                  className="text-button"
                  disabled={v.revision === generation.revision || busy}
                  onClick={async () => {
                    try {
                      const old = await api(
                        `generations/${id}?revision=${v.revision}`,
                      );
                      setDocument(old.document);
                      setDirty(true);
                      setReport({ ...old.validation, stale: true });
                    } catch (e) {
                      onError((e as Error).message);
                    }
                  }}
                >
                  {t.restore}
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
function BlocksEditor({
  blocks,
  onChange,
  t,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  t: Texts;
}) {
  function update(index: number, change: Partial<Block>) {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...change } : b)));
  }
  return (
    <div className="blocks">
      {blocks.map((b, i) => (
        <div className="block-editor" key={i}>
          <div className="block-top">
            <select
              aria-label={t.format}
              value={b.type}
              onChange={(e) => {
                const type = e.target.value as Block["type"];
                update(i, {
                  ...blank(type),
                  text: b.text,
                  ...(type === "table"
                    ? { columns: ["", ""], rows: [["", ""]] }
                    : type === "list"
                      ? { items: [b.text] }
                      : {}),
                });
              }}
            >
              {["paragraph", "list", "table", "code"].map((type) => (
                <option key={type} value={type}>
                  {(t as any)[type]}
                </option>
              ))}
            </select>
            {b.type === "code" && (
              <input
                aria-label={t.language}
                placeholder="Python 3.13"
                value={b.language}
                onChange={(e) => update(i, { language: e.target.value })}
              />
            )}
            <button
              className="icon-button"
              aria-label={t.remove}
              onClick={() => onChange(blocks.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
          {b.type === "list" ? (
            <textarea
              aria-label={t.list}
              value={b.items.join("\n")}
              onChange={(e) => update(i, { items: e.target.value.split("\n") })}
            />
          ) : b.type === "table" ? (
            <TableEditor
              block={b}
              onChange={(value) => update(i, value)}
              t={t}
            />
          ) : (
            <textarea
              className={b.type === "code" ? "code-input" : ""}
              aria-label={t[b.type]}
              value={b.text}
              onChange={(e) => update(i, { text: e.target.value })}
              maxLength={20000}
            />
          )}
        </div>
      ))}
      <button
        className="text-button"
        onClick={() => onChange([...blocks, blank()])}
      >
        <Plus size={13} />
        {t.addBlock}
      </button>
    </div>
  );
}
function Preview({
  doc,
  snapshot,
  audience,
  styles,
  t,
  onEditTask,
  onRegenerate,
}: {
  doc: GenerationDocument;
  snapshot: any;
  audience: string;
  styles: any;
  t: Texts;
  onEditTask: (id: string) => void;
  onRegenerate?: (task: TaskDocument) => void;
}) {
  return (
    <article
      className={`preview-paper ${styles.layout === "landscape-columns" ? "preview-landscape" : ""}`}
      style={{
        fontFamily: styles.font,
        fontSize: `${styles.size}pt`,
        lineHeight: styles.lineSpacing,
      }}
    >
      {styles.includeLogo && <small>ZiyatAI</small>}
      <h1>{doc.title}</h1>
      <p>
        {doc.grade} {t.grade.toLowerCase()}
      </p>
      {!snapshot.goalsSkipped && <p>{snapshot.goals}</p>}
      <div className="preview-student-tasks">
        {["easy", "medium", "advanced"].map((level) => (
          <section key={level}>
            <h2>{displayLevel(level, doc.localeMode)}</h2>
            {doc.tasks
              .filter((task) => task.level === level)
              .map((task) => (
                <div key={task.id}>
                  <h3>
                    {doc.tasks.findIndex((t) => t.id === task.id) + 1}. (
                    {displayPoints(task.points, doc.localeMode)})
                  </h3>
                  <DisplayBlocks blocks={task.contentBlocks} />
                  {task.translation && (
                    <DisplayBlocks blocks={task.translation.contentBlocks} />
                  )}
                  {styles.answerSpace && (
                    <div aria-hidden="true" className="preview-answer-lines">
                      {Array.from(
                        {
                          length:
                            task.level === "advanced"
                              ? 8
                              : task.level === "medium"
                                ? 6
                                : 4,
                        },
                        (_, i) => (
                          <div key={i} />
                        ),
                      )}
                    </div>
                  )}
                  <div className="preview-task-actions">
                    <button
                      className="text-button"
                      onClick={() => onEditTask(task.id)}
                    >
                      <Edit3 size={13} />
                      {doc.localeMode === "ru"
                        ? "Доработать задание"
                        : "Тапсырманы өңдеу"}
                    </button>
                    {onRegenerate && (
                      <button
                        className="text-button"
                        onClick={() => onRegenerate(task)}
                      >
                        <RefreshCw size={13} />
                        {doc.localeMode === "ru"
                          ? "Другой вариант"
                          : "Басқа нұсқа"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
      {audience === "full" && (
        <section
          style={{
            borderTop: "1px dashed #cbd5df",
            marginTop: 40,
            paddingTop: 30,
          }}
        >
          <h2>
            {doc.localeMode === "ru"
              ? "Ответы и объяснения"
              : "Жауаптар және түсіндірмелер"}
          </h2>
          {doc.tasks.map((task, i) => (
            <div key={task.id}>
              <h3>
                {i + 1}. {t.answer}
              </h3>
              <DisplayBlocks blocks={task.answerBlocks} />
              <p>
                {t.how}: {task.explanationHow}
              </p>
              <p>
                {t.why}: {task.explanationWhy}
              </p>
              {task.rubric.map((r, j) => (
                <p key={j}>
                  {r.criterion} — {r.points}
                </p>
              ))}
              {task.translation && (
                <div className="preview-translation">
                  <h4>Русская версия</h4>
                  <DisplayBlocks blocks={task.translation.answerBlocks} />
                  <p>Как решать: {task.translation.explanationHow}</p>
                  <p>Почему: {task.translation.explanationWhy}</p>
                  {task.translation.rubric.map((r, j) => (
                    <p key={j}>
                      {r.criterion} — {r.points}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
