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
import {
  summarizeTasks,
  taskLevels,
} from "../../../../packages/domain/task-summary";

export function TaskReview({
  document,
  t,
  locale,
  onEditTask,
  onRegenerate,
  minutes,
}: {
  document: GenerationDocument;
  t: Texts;
  locale: UiLocale;
  onEditTask: (id: string) => void;
  onRegenerate?: (task: TaskDocument) => void;
  minutes?: number;
}) {
  const ru = locale === "ru";
  const [level, setLevel] = useState<TaskDocument["level"] | "all">("all");
  const [studentView, setStudentView] = useState(false);
  const summary = summarizeTasks(document.tasks);
  const visible = document.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => level === "all" || task.level === level);
  return (
    <div className="task-review-list">
      <section
        className="task-workload"
        aria-label={ru ? "Нагрузка по уровням" : "Деңгейлер бойынша жүктеме"}
      >
        <p>
          {ru
            ? "Время и баллы указаны отдельно для каждого уровня сложности."
            : "Уақыт пен балл әр күрделілік деңгейі үшін бөлек көрсетілген."}
        </p>
        <div className="task-workload-grid">
          {summary.map((group) => (
            <div key={group.level}>
              <strong>{displayLevel(group.level, locale)}</strong>
              <span>
                {ru ? "Заданий" : "Тапсырмалар"}: {group.count}
              </span>
              <span>
                {group.minutes} мин · {displayPoints(group.points, locale)}
              </span>
              {minutes !== undefined &&
                Number.isFinite(minutes) &&
                minutes > 0 && (
                  <span
                    className={
                      group.minutes > minutes ? "task-time-over" : undefined
                    }
                  >
                    {group.minutes > minutes
                      ? ru
                        ? `Превышение на ${group.minutes - minutes} мин`
                        : `${group.minutes - minutes} мин артық`
                      : ru
                        ? `Запас времени: ${minutes - group.minutes} мин`
                        : `Қалған уақыт: ${minutes - group.minutes} мин`}
                  </span>
                )}
            </div>
          ))}
        </div>
      </section>
      <div className="task-review-controls">
        <label>
          {ru ? "Сложность" : "Күрделілік"}
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as typeof level)}
          >
            <option value="all">
              {ru ? "Все уровни" : "Барлық деңгейлер"}
            </option>
            {taskLevels.map((value) => (
              <option key={value} value={value}>
                {displayLevel(value, locale)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button secondary"
          aria-pressed={studentView}
          onClick={() => setStudentView((value) => !value)}
        >
          {ru ? "Просмотр ученика" : "Оқушы көрінісі"}
        </button>
        <span role="status">
          {ru ? "Показано заданий" : "Көрсетілген тапсырмалар"}:{" "}
          {visible.length} / {document.tasks.length}
        </span>
      </div>
      <p className="task-review-intro">
        {studentView
          ? ru
            ? "Показаны только условия. Это предварительный просмотр; для печати используйте экспорт DOCX/PDF."
            : "Тек тапсырма шарттары көрсетілген. Бұл алдын ала көрініс; басып шығару үшін DOCX/PDF экспортын пайдаланыңыз."
          : locale === "ru"
            ? "Проверьте условия и откройте ответы с критериями. Всё, что требует изменений, можно доработать отдельно."
            : "Шарттарды тексеріп, жауаптар мен критерийлерді ашыңыз. Өзгерту қажет тапсырманы жеке өңдеуге болады."}
      </p>
      {visible.length === 0 && (
        <p role="status">
          {ru ? "На этом уровне заданий нет." : "Бұл деңгейде тапсырмалар жоқ."}
        </p>
      )}
      {visible.map(({ task, index }) => (
        <ReviewCard
          key={`${task.id}:${studentView}`}
          task={task}
          index={index}
          t={t}
          locale={locale}
          onEditTask={onEditTask}
          onRegenerate={onRegenerate}
          studentView={studentView}
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
  studentView,
}: {
  task: TaskDocument;
  index: number;
  t: Texts;
  locale: UiLocale;
  onEditTask: (id: string) => void;
  onRegenerate?: (task: TaskDocument) => void;
  studentView: boolean;
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
      {!studentView && (
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
      )}
      {!studentView && (
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
              aria-label={`${ru ? "Другой вариант задания" : "Басқа нұсқа · Тапсырма"} ${index + 1}`}
            >
              <RefreshCw size={14} />
              {ru ? "Другой вариант" : "Басқа нұсқа"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
