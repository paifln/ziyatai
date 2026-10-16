"use client";
import { useState } from "react";
import { ArrowUpRight, Check, BookOpen } from "lucide-react";
import type { UiLocale } from "../../lib/i18n";

/** A clearly labelled synthetic sample, usable before creating an account. */
export function LessonPreview({ locale }: { locale: UiLocale }) {
  const [level, setLevel] = useState(0);
  const [answer, setAnswer] = useState(false);
  const ru = locale === "ru";
  const levels = ru
    ? ["Лёгкий", "Средний", "Сложный"]
    : ["Жеңіл", "Орта", "Күрделі"];
  const questions = ru
    ? [
        "В классе 24 ученика. Сколько учеников составляют 25% класса?",
        "В классе 24 ученика. 25% выбрали шахматы, а остальные — робототехнику. Сколько учеников выбрали робототехнику?",
        "В двух классах по 24 ученика. В первом шахматы выбрали 25%, во втором — 50%. Какую долю всех учеников составляют участники шахмат?",
      ]
    : [
        "Сыныпта 24 оқушы бар. Сыныптың 25%-ы неше оқушы?",
        "Сыныпта 24 оқушы бар. 25%-ы шахматты, қалғаны робототехниканы таңдады. Робототехниканы неше оқушы таңдады?",
        "Екі сыныптың әрқайсысында 24 оқушы бар. Бірінші сыныптың 25%-ы, екіншісінің 50%-ы шахматты таңдады. Барлық оқушылардың қандай бөлігі шахматқа қатысады?",
      ];
  const answers = ru
    ? [
        "24 × 0,25 = 6 учеников.",
        "24 − 24 × 0,25 = 18 учеников.",
        "(6 + 12) / 48 = 0,375 = 37,5%.",
      ]
    : [
        "24 × 0,25 = 6 оқушы.",
        "24 − 24 × 0,25 = 18 оқушы.",
        "(6 + 12) / 48 = 0,375 = 37,5%.",
      ];
  return (
    <div className="lesson-sample">
      <div className="lesson-sample-top">
        <span>
          <BookOpen size={16} />{" "}
          {ru ? "Математика · 6 класс" : "Математика · 6-сынып"}
        </span>
        <span className="sample-tag">{ru ? "Пример" : "Мысал"}</span>
      </div>
      <h2>
        {ru
          ? "Одна тема. Разные возможности."
          : "Бір тақырып. Әртүрлі мүмкіндік."}
      </h2>
      <div
        className="sample-levels"
        role="tablist"
        aria-label={ru ? "Уровень примера" : "Мысал деңгейі"}
      >
        {levels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            id={`sample-tab-${i}`}
            aria-selected={i === level}
            aria-controls="sample-question"
            tabIndex={i === level ? 0 : -1}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (level + (event.key === "ArrowRight" ? 1 : 2)) % 3;
              setLevel(next);
              setAnswer(false);
              document.getElementById(`sample-tab-${next}`)?.focus();
            }}
            onClick={() => {
              setLevel(i);
              setAnswer(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="sample-question"
        role="tabpanel"
        aria-labelledby={`sample-tab-${level}`}
        tabIndex={0}
      >
        <span className="sample-number">{ru ? "Задание" : "Тапсырма"} 01</span>
        <p>{questions[level]}</p>
        <button
          type="button"
          className="sample-answer-toggle"
          aria-expanded={answer}
          aria-controls="sample-answer"
          onClick={() => setAnswer(!answer)}
        >
          {answer ? <Check size={16} /> : <ArrowUpRight size={16} />}
          {answer
            ? ru
              ? "Скрыть решение"
              : "Шешімін жасыру"
            : ru
              ? "Посмотреть решение"
              : "Шешімін көру"}
        </button>
        <div id="sample-answer" className="sample-answer" hidden={!answer}>
          {answers[level]}
        </div>
      </div>
      <div className="sample-bottom">
        <span>КТЖ → {ru ? "Задания" : "Тапсырмалар"} → DOCX / PDF</span>
        <span>KK / RU</span>
      </div>
    </div>
  );
}
