"use client";
import { Plus, Trash2, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import {
  displayLevel,
  displayPoints,
} from "../../../../packages/domain/validation";
import { BlocksEditor } from "../../components/generations/BlocksEditor";
import { TaskReview } from "../../components/generations/TaskReview";
import type { GenerationEditorViewState } from "./view-state";
import Preview from "./GenerationPreview";
export function GenerationTaskEditor({
  view,
}: {
  view: GenerationEditorViewState;
}) {
  const {
    t,
    locale,
    generation,
    document,
    setDocument,
    mode,
    audience,
    styles,
    dirty,
    setDirty,
    activeTask,
    setActiveTask,
    busy,
    changeTask,
    regenerate,
    editTask,
  } = view;
  return (
    <fieldset className="editor-fields" disabled={busy}>
      <legend className="sr-only">{t.editor}</legend>
      {mode === "review" ? (
        <TaskReview
          document={document}
          minutes={generation.source_snapshot?.minutes}
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
            data-expanded={activeTask ? activeTask === task.id : index === 0}
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
                  {displayPoints(task.points, locale)} · {task.estimatedMinutes}{" "}
                  мин
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
                  index === 0 || document.tasks[index - 1]?.level !== task.level
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
  );
}
