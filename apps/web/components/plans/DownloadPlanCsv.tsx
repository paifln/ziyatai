"use client";
import { Download } from "lucide-react";
import type { KtpRow } from "../../../../packages/contracts";
import { planCsv } from "../../../../packages/domain/plan-csv";
import type { UiLocale } from "../../lib/i18n";

export function DownloadPlanCsv({
  rows,
  grade,
  locale,
  disabled,
}: {
  rows: KtpRow[];
  grade: number | null;
  locale: UiLocale;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="button secondary"
      disabled={disabled || !rows.length}
      title={
        locale === "ru"
          ? "Все строки с текущими правками, включая скрытые фильтрами. Скачивание не сохраняет изменения в аккаунте."
          : "Сүзгі жасырған жолдарды қоса, ағымдағы өзгерістері бар барлық жолдар. Жүктеу аккаунттағы өзгерістерді сақтамайды."
      }
      onClick={() => {
        const blob = new Blob([planCsv(rows, grade, locale)], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "ZiyatAI-KTP.csv";
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }}
    >
      <Download size={16} aria-hidden="true" />
      {locale === "ru" ? "Скачать весь КТП (CSV)" : "Бүкіл КТЖ жүктеу (CSV)"}
    </button>
  );
}
