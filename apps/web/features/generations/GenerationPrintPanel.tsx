"use client";
import { Check, Download } from "lucide-react";
import { validationMessage } from "../../../../packages/domain/validation-messages";
import { Jobs } from "../../components/Jobs";
import type { GenerationEditorViewState } from "./view-state";
export function GenerationPrintPanel({
  view,
}: {
  view: GenerationEditorViewState;
}) {
  const {
    id,
    t,
    locale,
    onError,
    onSaved,
    refresh,
    api,
    generation,
    versions,
    setMode,
    audience,
    setAudience,
    styles,
    setStyles,
    exportJobs,
    report,
    setReport,
    dirty,
    setActiveTask,
    teacherReviewed,
    setTeacherReviewed,
    busy,
    refreshExports,
    exportFile,
    approve,
    restoreVersion,
  } = view;
  return (
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
                !teacherReviewed || dirty || busy || !!report?.issues?.length
              }
            >
              <Check size={16} />
              {locale === "ru" ? "Одобрить задания" : "Тапсырмаларды мақұлдау"}
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
                  layout: e.target.value as "portrait" | "landscape-columns",
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
              setReport(await api(`generations/${id}/validate`, "POST", {}));
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
              onClick={() => void restoreVersion(v.revision)}
            >
              {t.restore}
            </button>
          </div>
        ))}
      </section>
    </aside>
  );
}
