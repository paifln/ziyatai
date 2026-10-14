"use client";
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
} from "lucide-react";
import { api } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
import {
  Styles,
  type GenerationDocument,
  type TaskDocument,
} from "../../../packages/contracts";
import { displayLevel } from "../../../packages/domain/validation";
import { Jobs } from "./Workspace";
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
  onSaved,
  refresh,
}: {
  id: string;
  t: Texts;
  locale: UiLocale;
  jobs: any[];
  profileStyles: any;
  onError: (s: string) => void;
  onSaved: () => void;
  refresh: () => Promise<void>;
}) {
  const [generation, setGeneration] = useState<any>(),
    [document, setDocument] = useState<GenerationDocument>(),
    [versions, setVersions] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [audience, setAudience] = useState<"full" | "student">("full"),
    [styles, setStyles] = useState(Styles.parse(profileStyles)),
    [exportJobs, setExportJobs] = useState<any[]>([]),
    [report, setReport] = useState<any>();
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
  useEffect(() => {
    if (generation?.status === "queued") {
      const timer = setInterval(() => void load(), 2000);
      return () => clearInterval(timer);
    }
  }, [generation?.status, load]);
  useEffect(() => {
    if (!exportJobs.length) return;
    const timer = setInterval(async () => {
      const next = await Promise.all(
        exportJobs.map((j) => api(`jobs/${j.id}`)),
      );
      setExportJobs(next);
    }, 2000);
    return () => clearInterval(timer);
  }, [exportJobs]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
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
      };
      const result = await api("exports", "POST", data, requestKey(data));
      setExportJobs([
        ...exportJobs,
        {
          id: result.jobId,
          status: "queued",
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
      const timer = setInterval(async () => {
        try {
          const result = await api(`jobs/${j.jobId}`);
          if (["succeeded", "failed", "cancelled"].includes(result.status)) {
            clearInterval(timer);
            setBusy(false);
            if (result.status === "succeeded") {
              await load();
              onSaved();
            } else onError(result.error?.message ?? t.failed);
            await refresh();
          }
        } catch (e) {
          clearInterval(timer);
          setBusy(false);
          onError((e as Error).message);
        }
      }, 2000);
      await refresh();
    } catch (e) {
      setBusy(false);
      onError((e as Error).message);
    }
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
          <span className="badge gold">{t.draft}</span>
          {generation.demo && (
            <div className="notice warning">{t.demoLabel}</div>
          )}
        </div>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => setPreview(!preview)}
          >
            {preview ? <Edit3 size={16} /> : <Eye size={16} />}{" "}
            {preview
              ? t.editor
              : locale === "ru"
                ? "Предпросмотр"
                : "Алдын ала қарау"}
          </button>
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
      {dirty && (
        <div className="notice warning">
          {locale === "ru"
            ? "Есть несохранённые изменения. Сохраните перед экспортом."
            : "Сақталмаған өзгерістер бар. Экспортқа дейін сақтаңыз."}
        </div>
      )}
      <div className="editor-layout">
        <div>
          {preview ? (
            <Preview
              doc={document}
              snapshot={generation.source_snapshot}
              audience={audience}
              styles={styles}
              t={t}
            />
          ) : (
            document.tasks.map((task, index) => (
              <section className="task-card" key={task.id}>
                <div className="task-header">
                  <span className="task-number">{index + 1}</span>
                  <strong>{displayLevel(task.level, locale)}</strong>
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
                        changeTask(index, { explanationHow: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t.why}
                    <textarea
                      value={task.explanationWhy}
                      onChange={(e) =>
                        changeTask(index, { explanationWhy: e.target.value })
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
                          changeTask(index, { points: Number(e.target.value) })
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
                              j === i ? { ...r, criterion: e.target.value } : r,
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
                        rubric: [...task.rubric, { criterion: "", points: 1 }],
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
                      Русская версия
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
              </section>
            ))
          )}
        </div>
        <aside className="editor-side">
          <section className="card">
            <h2>{t.export}</h2>
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
              {t.font}
              <select
                value={styles.font}
                onChange={(e) =>
                  setStyles({ ...styles, font: e.target.value as any })
                }
              >
                {["Times New Roman", "Arial", "Calibri"].map((f) => (
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
                        setStyles({ ...styles, [key]: Number(e.target.value) })
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
                disabled={busy || dirty}
                onClick={() => exportFile("docx")}
              >
                <Download size={14} />
                DOCX
              </button>
              <button
                className="button secondary"
                disabled={busy || dirty}
                onClick={() => exportFile("pdf")}
              >
                <Download size={14} />
                PDF
              </button>
            </div>
            {exportJobs.map((job) => (
              <div key={job.id} className="notice" role="status">
                {["queued", "running"].includes(job.status) ? (
                  <>
                    <span className="spinner" /> {t.exporting}
                  </>
                ) : job.status === "succeeded" ? (
                  <a
                    className="text-button"
                    href={`/api/exports/${job.result.exportId}/download`}
                  >
                    {t.download}
                    <Download size={14} />
                  </a>
                ) : (
                  <span>{job.error?.message ?? t.failed}</span>
                )}
              </div>
            ))}
          </section>
          <section className="card">
            <h2>{t.review}</h2>
            <p style={{ fontSize: 12 }}>{t.teacherWarning}</p>
            {report?.stale && (
              <div className="notice warning">
                {locale === "ru"
                  ? "После изменения задания проверку нужно повторить."
                  : "Тапсырманы өзгерткеннен кейін қайта тексеру қажет."}
              </div>
            )}
            {report?.issues?.length > 0 && (
              <div className="notice warning">
                {locale === "ru"
                  ? "Есть ошибки структуры, баллов или ссылок на цели. Проверьте отредактированные задания."
                  : "Құрылымда, балдарда немесе мақсат сілтемелерінде қате бар. Өңделген тапсырмаларды тексеріңіз."}
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
            <>
              <div className="table-grid">
                <table>
                  <thead>
                    <tr>
                      {b.columns.map((col, j) => (
                        <th key={j}>
                          <input
                            aria-label={`${t.table} ${j + 1}`}
                            value={col}
                            onChange={(e) =>
                              update(i, {
                                columns: b.columns.map((c, k) =>
                                  k === j ? e.target.value : c,
                                ),
                              })
                            }
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>
                            <input
                              aria-label={`${t.table} ${ri + 1}, ${ci + 1}`}
                              value={cell}
                              onChange={(e) =>
                                update(i, {
                                  rows: b.rows.map((r, rj) =>
                                    rj === ri
                                      ? r.map((c, cj) =>
                                          cj === ci ? e.target.value : c,
                                        )
                                      : r,
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button
                  className="text-button"
                  onClick={() =>
                    update(i, { rows: [...b.rows, b.columns.map(() => "")] })
                  }
                >
                  <Plus size={12} />
                  {t.addRow}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    update(i, {
                      columns: [...b.columns, ""],
                      rows: b.rows.map((row) => [...row, ""]),
                    })
                  }
                >
                  <Plus size={12} />
                  {t.table}
                </button>
              </div>
            </>
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
function DisplayBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="preview-block">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <pre key={i}>{b.text}</pre>
        ) : b.type === "list" ? (
          <ul key={i}>
            {b.items.map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ul>
        ) : b.type === "table" ? (
          <table key={i}>
            <thead>
              <tr>
                {b.columns.map((s, j) => (
                  <th key={j}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((s, k) => (
                    <td key={k}>{s}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}
function Preview({
  doc,
  snapshot,
  audience,
  styles,
  t,
}: {
  doc: GenerationDocument;
  snapshot: any;
  audience: string;
  styles: any;
  t: Texts;
}) {
  return (
    <article
      className="preview-paper"
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
      <p>{snapshot.goals}</p>
      {["easy", "medium", "advanced"].map((level) => (
        <section key={level}>
          <h2>{displayLevel(level, doc.localeMode)}</h2>
          {doc.tasks
            .filter((task) => task.level === level)
            .map((task) => (
              <div key={task.id}>
                <h3>
                  {doc.tasks.findIndex((t) => t.id === task.id) + 1}. (
                  {task.points} {t.points.toLowerCase()})
                </h3>
                <DisplayBlocks blocks={task.contentBlocks} />
                {task.translation && (
                  <DisplayBlocks blocks={task.translation.contentBlocks} />
                )}
              </div>
            ))}
        </section>
      ))}
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
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
