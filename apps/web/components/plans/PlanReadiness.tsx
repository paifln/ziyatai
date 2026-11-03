"use client";
import type { planIssues } from "../../../../packages/domain/plan-review";
import type { UiLocale } from "../../lib/i18n";

export function PlanReadiness({
  issues,
  total,
  locale,
  filtered,
  onFilter,
  onFirst,
}: {
  issues: ReturnType<typeof planIssues>;
  total: number;
  locale: UiLocale;
  filtered: boolean;
  onFilter: () => void;
  onFirst: () => void;
}) {
  const ru = locale === "ru";
  return (
    <section
      className="plan-readiness"
      aria-label={
        ru ? "Готовность КТП к подтверждению" : "КТЖ растауға дайындығы"
      }
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        <strong>
          {issues.length
            ? ru
              ? `Строки с пропусками: ${issues.length} из ${total}`
              : `Толтырылмаған жолдар: ${issues.length} / ${total}`
            : ru
              ? "Обязательные поля заполнены"
              : "Міндетті өрістер толтырылған"}
        </strong>
        <p>
          {issues.length
            ? ru
              ? "Для подтверждения заполните темы, текст целей и классы. Проверяется весь КТП, включая скрытые фильтрами строки."
              : "Растау үшін тақырыптарды, мақсат мәтінін және сыныптарды толтырыңыз. Сүзгі жасырған жолдарды қоса, бүкіл КТЖ тексеріледі."
            : ru
              ? "Сверьте содержание с исходником перед подтверждением. Заполненные поля не заменяют проверку учителя."
              : "Растау алдында мазмұнды түпнұсқамен салыстырыңыз. Толтырылған өрістер мұғалімнің тексеруін алмастырмайды."}
        </p>
      </div>
      <div className="actions">
        <button
          type="button"
          className="button secondary"
          aria-pressed={filtered}
          disabled={!issues.length && !filtered}
          onClick={onFilter}
        >
          {filtered
            ? ru
              ? "Показать все строки"
              : "Барлық жолдарды көрсету"
            : ru
              ? "Только строки с пропусками"
              : "Тек толтырылмаған жолдар"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!issues.length}
          onClick={onFirst}
        >
          {ru ? "К первому пропуску" : "Бірінші бос өріске өту"}
        </button>
      </div>
    </section>
  );
}
