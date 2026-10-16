"use client";
import { useState } from "react";
import { Clock3, Edit3, RefreshCw } from "lucide-react";
import type {
  GenerationDocument,
  TaskDocument,
} from "../../../../packages/contracts";
import {
  displayLevel,
  displayPoints,
} from "../../../../packages/domain/validation";
import type { Texts, UiLocale } from "../../lib/i18n";
import { DisplayBlocks } from "./DisplayBlocks";

export function TaskReview({
  document,
  t,
  locale,
  onEditTask,
  onRegenerate,
}: {
  document: GenerationDocument;
  t: Texts;
  locale: UiLocale;
  onEditTask: (id: string) => void;
  onRegenerate?: (task: TaskDocument) => void;
}) {
  return (
    <div className="task-review-list">
      <p className="task-review-intro">
        {locale === "ru"
          ? "Проверьте условия и откройте ответы с критериями. Всё, что требует изменений, можно доработать отдельно."
          : "Шарттарды тексеріп, жауаптар мен критерийлерді ашыңыз. Өзгерту қажет тапсырманы жеке өңдеуге болады."}
      </p>
      {document.tasks.map((task, index) => (
        <ReviewCard
          key={task.id}
          task={task}
          index={index}
          t={t}
          locale={locale}
          onEditTask={onEditTask}
          onRegenerate={onRegenerate}
        />
      ))}
    </div>
  );
}
function ReviewCard({
  task,
  index,
  t,
  locale,
  onEditTask,
  onRegenerate,
}: {
  task: TaskDocument;
  index: number;
  t: Texts;
  locale: UiLocale;
  onEditTask: (id: string) => void;
  onRegenerate?: (task: TaskDocument) => void;
}) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const ru = locale === "ru";
  return (
    <article className="task-review-card">
      <header>
        <span className={`review-level ${task.level}`}>
          {displayLevel(task.level, locale)}
        </span>
        <span className="review-task-meta">
          {displayPoints(task.points, locale)}
          <span aria-hidden="true">·</span>
          <Clock3 size={13} />
          {task.estimatedMinutes} {ru ? "мин" : "мин"}
        </span>
      </header>
      <h2>
        {ru ? "Задание" : "Тапсырма"} {index + 1}
      </h2>
      <DisplayBlocks blocks={task.contentBlocks} />
      {task.translation && (
        <section lang="ru" className="review-translation">
          <h3>Русская версия</h3>
          <DisplayBlocks blocks={task.translation.contentBlocks} />
        </section>
      )}
      <details
        className="review-answer"
        onToggle={(e) => setAnswersOpen(e.currentTarget.open)}
      >
        <summary>
          {ru
            ? "Ответ, объяснение и критерии"
            : "Жауап, түсіндірме және критерийлер"}
        </summary>
        {answersOpen && (
          <div className="review-answer-content">
            <h3>{t.answer}</h3>
            <DisplayBlocks blocks={task.answerBlocks} />
            <h3>{t.how}</h3>
            <p>{task.explanationHow}</p>
            <h3>{t.why}</h3>
            <p>{task.explanationWhy}</p>
            <h3>{t.rubric}</h3>
            <ul>
              {task.rubric.map((r, i) => (
                <li key={i}>
                  <span>{r.criterion}</span>
                  <strong>{displayPoints(r.points, locale)}</strong>
                </li>
              ))}
            </ul>
            {task.translation && (
              <section lang="ru" className="review-translation">
                <h3>Русская версия · Ответ</h3>
                <DisplayBlocks blocks={task.translation.answerBlocks} />
                <h3>Как решать</h3>
                <p>{task.translation.explanationHow}</p>
                <h3>Почему</h3>
                <p>{task.translation.explanationWhy}</p>
                <h3>Критерии</h3>
                <ul>
                  {task.translation.rubric.map((r, i) => (
                    <li key={i}>
                      <span>{r.criterion}</span>
                      <strong>{r.points}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </details>
      <div className="review-task-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => onEditTask(task.id)}
          aria-label={`${ru ? "Доработать задание" : "Тапсырманы өңдеу"} ${index + 1}`}
        >
          <Edit3 size={14} />
          {ru ? "Доработать" : "Өңдеу"}
        </button>
        {onRegenerate && (
          <button
            type="button"
            className="text-button"
            onClick={() => onRegenerate(task)}
            aria-label={`${ru ? "Другой вариант задания" : "Тапсырманың басқа нұсқасы"} ${index + 1}`}
          >
            <RefreshCw size={14} />
            {ru ? "Другой вариант" : "Басқа нұсқа"}
          </button>
        )}
      </div>
    </article>
  );
}
