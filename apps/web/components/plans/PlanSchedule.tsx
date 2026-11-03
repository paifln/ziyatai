"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import type { KtpRow } from "../../../../packages/contracts";
import {
  lessonSchedule,
  schoolDate,
} from "../../../../packages/domain/lesson-schedule";
import { rowGrade } from "../../../../packages/domain/grades";
import type { UiLocale } from "../../lib/i18n";

export function PlanSchedule({
  rows,
  grade,
  classFilter,
  locale,
  disabled,
  onOpen,
}: {
  rows: KtpRow[];
  grade: number | null;
  classFilter: string;
  locale: UiLocale;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const [today, setToday] = useState("");
  useEffect(() => {
    const update = () => setToday(schoolDate());
    update();
    const timer = setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const schedule = useMemo(
    () =>
      today
        ? lessonSchedule(
            rows.filter(
              (row) =>
                !classFilter ||
                String(rowGrade(row, grade) ?? "unknown") === classFilter,
            ),
            today,
          )
        : undefined,
    [rows, today, grade, classFilter],
  );
  const ru = locale === "ru";
  const dateLabel = (value: string) =>
    new Intl.DateTimeFormat(ru ? "ru-RU" : "kk-KZ", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(value + "T12:00:00Z"));
  return (
    <details className="card plan-schedule">
      <summary>
        <CalendarDays size={18} aria-hidden="true" />
        <strong>{ru ? "Ближайшие уроки" : "Алдағы сабақтар"}</strong>
        {schedule && <span>{schedule.upcomingCount}</span>}
      </summary>
      {schedule && (
        <>
          <p className="muted">
            {ru
              ? `По датам КТП, начиная с ${dateLabel(today)} (время Казахстана). Учитывается выбранный класс. Даты без года и неоднозначные значения не включены.`
              : `${dateLabel(today)} күнінен бастап КТЖ күндері бойынша (Қазақстан уақыты). Таңдалған сынып ескеріледі. Жылы жоқ және бірмәнді емес күндер қосылмаған.`}
          </p>
          {schedule.upcoming.length ? (
            <ol className="plan-schedule-list">
              {schedule.upcoming.map((item) => (
                <li key={item.row.id}>
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => onOpen(item.row.id)}
                  >
                    <span>
                      <strong>
                        {item.row.topic ||
                          (ru ? "Тема не указана" : "Тақырып көрсетілмеген")}
                      </strong>
                      <small>
                        {item.row.lessonNumberRaw
                          ? `${ru ? "Урок" : "Сабақ"} ${item.row.lessonNumberRaw} · `
                          : ""}
                        {rowGrade(item.row, grade)
                          ? `${rowGrade(item.row, grade)} ${ru ? "класс" : "сынып"} · `
                          : ""}
                        {dateLabel(item.start)}
                        {item.end !== item.start
                          ? ` — ${dateLabel(item.end)}`
                          : ""}
                        {item.ongoing
                          ? ` · ${ru ? "Идёт сегодня" : "Бүгін өтеді"}`
                          : ""}
                      </small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>
              {ru
                ? "По указанным датам текущих и будущих уроков нет."
                : "Көрсетілген күндер бойынша ағымдағы және алдағы сабақтар жоқ."}
            </p>
          )}
          {!!schedule.undated && (
            <p className="muted">
              {ru ? "Без определённой даты" : "Күні анықталмаған"}:{" "}
              {schedule.undated}.{" "}
              {ru
                ? "При необходимости уточните даты в таблице."
                : "Қажет болса, кестедегі күндерді нақтылаңыз."}
            </p>
          )}
          {schedule.upcomingCount > schedule.upcoming.length && (
            <p className="muted">
              {ru
                ? "Показаны ближайшие пять уроков. Остальные доступны в таблице с сортировкой по дате."
                : "Ең жақын бес сабақ көрсетілген. Қалғандары күн бойынша сұрыпталған кестеде қолжетімді."}
            </p>
          )}
        </>
      )}
    </details>
  );
}
