"use client";
import { RefreshCw, Edit3 } from "lucide-react";
import type { Texts } from "../../lib/i18n";
import {
  type GenerationDocument,
  type TaskDocument,
} from "../../../../packages/contracts";
import {
  displayLevel,
  displayPoints,
} from "../../../../packages/domain/validation";
import { DisplayBlocks } from "../../components/generations/DisplayBlocks";
export default function Preview({
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
