import { Check } from "lucide-react";
import type { UiLocale } from "../../lib/i18n";
export function Workflow({
  step,
  locale,
}: {
  step: 1 | 2 | 3;
  locale: UiLocale;
}) {
  const labels =
    locale === "ru"
      ? ["Загрузить КТП", "Проверить темы", "Создать задания"]
      : ["КТЖ жүктеу", "Тақырыптарды тексеру", "Тапсырма жасау"];
  return (
    <ol
      className="workflow"
      aria-label={
        locale === "ru" ? "Подготовка материалов" : "Материалдарды дайындау"
      }
    >
      {labels.map((label, i) => (
        <li
          key={label}
          className={
            i + 1 === step ? "current" : i + 1 < step ? "complete" : ""
          }
          aria-current={i + 1 === step ? "step" : undefined}
        >
          <span>{i + 1 < step ? <Check size={14} /> : `0${i + 1}`}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );
}
