"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/client";
import type { Texts, UiLocale } from "../../lib/i18n";

type PlanChoice = { id: string; title: string };

/** Search the whole owned collection, rather than the dashboard's first page. */
export function ConfirmedPlanPicker({
  value,
  selectedTitle,
  onChange,
  onError,
  locale,
  t,
}: {
  value: string;
  selectedTitle?: string;
  onChange: (id: string) => void;
  onError: (message: string) => void;
  locale: UiLocale;
  t: Texts;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [choices, setChoices] = useState<PlanChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          status: "confirmed",
          q: query,
          limit: "21",
          offset: String(page * 20),
        });
        api(`ktp?${params}`, "GET", undefined, undefined, controller.signal)
          .then((result: PlanChoice[]) => {
            setChoices(result.slice(0, 20));
            setMore(result.length > 20);
          })
          .catch((error: Error) => {
            if (!controller.signal.aborted) {
              setFailed(true);
              onError(error.message);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, onError, retry]);
  useEffect(() => {
    if (!value && choices[0]) onChange(choices[0].id);
  }, [choices, value, onChange]);
  const ru = locale === "ru";
  return (
    <div className="field-group" aria-busy={loading}>
      <label htmlFor="confirmed-plan-search">
        {ru ? "Найти КТП по названию" : "КТЖ атауы бойынша іздеу"}
      </label>
      <input
        id="confirmed-plan-search"
        type="search"
        maxLength={200}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
      />
      <label htmlFor="confirmed-plan-choice">{t.choosePlan}</label>
      <select
        id="confirmed-plan-choice"
        value={value}
        disabled={loading || failed || (!choices.length && !value)}
        onChange={(event) => onChange(event.target.value)}
      >
        {!value && <option value="">{t.select}</option>}
        {value && !choices.some((p) => p.id === value) && (
          <option value={value}>
            {selectedTitle || (ru ? "Выбранный КТП" : "Таңдалған КТЖ")}
          </option>
        )}
        {choices.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {plan.title}
          </option>
        ))}
      </select>
      <div role="status" aria-live="polite" className="muted">
        {loading
          ? t.loading
          : failed
            ? ru
              ? "Не удалось получить список КТП."
              : "КТЖ тізімі жүктелмеді."
            : !choices.length
              ? query
                ? ru
                  ? "По этому названию ничего не найдено."
                  : "Бұл атау бойынша ештеңе табылмады."
                : t.noConfirmed
              : ""}
      </div>
      {failed && (
        <button
          type="button"
          className="button secondary"
          onClick={() => setRetry((n) => n + 1)}
        >
          {ru ? "Повторить" : "Қайталау"}
        </button>
      )}
      {(page > 0 || more) && (
        <nav
          className="pagination"
          aria-label={ru ? "Страницы списка КТП" : "КТЖ тізімінің беттері"}
        >
          <button
            type="button"
            className="button secondary"
            disabled={loading || page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {ru ? "Назад" : "Артқа"}
          </button>
          <span>{page + 1}</span>
          <button
            type="button"
            className="button secondary"
            disabled={loading || !more}
            onClick={() => setPage((p) => p + 1)}
          >
            {ru ? "Далее" : "Келесі"}
          </button>
        </nav>
      )}
    </div>
  );
}
