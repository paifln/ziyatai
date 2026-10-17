"use client";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  FileText,
  ChevronRight,
  Trash2,
  FolderOpen,
  X,
  ArrowUpRight,
} from "lucide-react";
import type { Texts, UiLocale } from "../../lib/i18n";
import { api } from "../../lib/client";
import type {
  PlanCollectionPage,
  PlanSummary,
} from "../../../../packages/contracts/plan-collection";
import {
  planStatuses,
  type PlanStatusValue,
} from "../../../../packages/domain/plan-status";
export function PlanCollection({
  revision,
  t,
  locale,
  onUpload,
  onOpen,
  onRemove,
  onDemo,
  busy,
}: {
  revision: number;
  t: Texts;
  locale: UiLocale;
  onUpload: () => void;
  onOpen: (plan: PlanSummary) => void;
  onRemove: (id: string) => void;
  onDemo?: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [grade, setGrade] = useState("");
  const [sort, setSort] = useState("recent");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PlanCollectionPage>();
  const [pageKey, setPageKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const caption = useRef<HTMLDivElement>(null);
  const focusResults = useRef(false);
  const inFlight = useRef<
    | { key: string; started: boolean; again: boolean; cancel: () => void }
    | undefined
  >(undefined);
  const requestKey = new URLSearchParams({
    q: query,
    sort,
    limit: "20",
    offset: String(offset),
    ...(grade ? { grade } : {}),
    ...(status !== "all" ? { status } : {}),
  }).toString();
  const ready = pageKey === requestKey;
  useEffect(
    () => () => {
      inFlight.current?.cancel();
      inFlight.current = undefined;
    },
    [],
  );
  useEffect(() => {
    // Polling/resume invalidations queue one refresh instead of starving a slow
    // request. A changed filter or page still cancels obsolete work immediately.
    if (inFlight.current?.key === requestKey) {
      if (inFlight.current.started) inFlight.current.again = true;
      return;
    }
    inFlight.current?.cancel();
    const controller = new AbortController();
    const pending = {
      key: requestKey,
      started: false,
      again: false,
      cancel: () => {
        clearTimeout(timer);
        controller.abort();
      },
    };
    inFlight.current = pending;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () => {
        pending.started = true;
        let succeeded = false;
        void api(
          `ktp/collection?${requestKey}`,
          "GET",
          undefined,
          undefined,
          controller.signal,
        )
          .then((result: PlanCollectionPage) => {
            if (controller.signal.aborted) return;
            succeeded = true;
            setPage(result);
            setPageKey(requestKey);
            if (
              result.offset !==
              Number(new URLSearchParams(requestKey).get("offset"))
            )
              setOffset(result.offset);
            setLoading(false);
            if (focusResults.current) {
              focusResults.current = false;
              caption.current?.focus();
            }
          })
          .catch((e: Error) => {
            if (controller.signal.aborted) return;
            setError(e.message);
            setLoading(false);
          })
          .finally(() => {
            if (inFlight.current !== pending) return;
            inFlight.current = undefined;
            if (pending.again && succeeded) setRetry((n) => n + 1);
          });
      },
      new URLSearchParams(requestKey).get("q") ? 250 : 0,
    );
  }, [requestKey, revision, retry]);
  const ru = locale === "ru";
  const isReview = (p: PlanSummary) => p.status === "review";
  const otherStatuses = planStatuses.filter(
    (value) =>
      value !== "confirmed" &&
      value !== "review" &&
      ((page?.counts[value] ?? 0) > 0 || status === value),
  );
  const visible = page?.items ?? [];
  const tabs = [
    ["all", ru ? "Все планы" : "Барлық жоспар", page?.total ?? 0],
    ["confirmed", t.confirmed, page?.counts.confirmed ?? 0],
    ["review", t.review, page?.counts.review ?? 0],
  ] as const;
  function reset() {
    focusResults.current = false;
    setQuery("");
    setGrade("");
    setStatus("all");
    setOffset(0);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {ru
              ? "Материалы для ваших уроков"
              : "Сабақтарыңызға арналған материалдар"}
          </span>
          <h1>{t.plans}</h1>
          <p>{t.uploadSub}</p>
        </div>
        <button className="button primary" onClick={onUpload}>
          <Plus size={18} />
          {t.upload}
        </button>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            {t.retry}
          </button>
        </div>
      )}
      {page?.total !== 0 ? (
        <>
          <div
            className="filter-chips"
            aria-label={ru ? "Статус КТП" : "КТЖ күйі"}
          >
            {tabs.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => {
                  focusResults.current = false;
                  setStatus(value);
                  setOffset(0);
                }}
              >
                {label}
                <small>{count}</small>
              </button>
            ))}
          </div>
          <div className="toolbar plan-toolbar">
            {otherStatuses.length > 0 && (
              <select
                aria-label={ru ? "Другие статусы КТП" : "КТЖ-ның басқа күйлері"}
                value={
                  otherStatuses.includes(status as PlanStatusValue)
                    ? status
                    : ""
                }
                onChange={(e) => {
                  focusResults.current = false;
                  setStatus(e.target.value || "all");
                  setOffset(0);
                }}
              >
                <option value="">
                  {ru ? "Другие статусы КТП" : "КТЖ-ның басқа күйлері"}
                </option>
                {otherStatuses.map((value) => (
                  <option key={value} value={value}>
                    {t[value]} · {page?.counts[value] ?? 0}
                  </option>
                ))}
              </select>
            )}
            <label className="search-field">
              <span className="sr-only">
                {ru ? "Найти КТП по названию" : "КТЖ атауы бойынша іздеу"}
              </span>
              <Search size={17} />
              <input
                type="search"
                maxLength={200}
                placeholder={
                  ru ? "Найти КТП по названию…" : "КТЖ атауы бойынша іздеу…"
                }
                value={query}
                onChange={(event) => {
                  focusResults.current = false;
                  setQuery(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <select
              aria-label={ru ? "Фильтр по классу" : "Сынып бойынша сүзгі"}
              value={grade}
              onChange={(event) => {
                focusResults.current = false;
                setGrade(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{ru ? "Все классы" : "Барлық сынып"}</option>
              {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {t.grade.toLowerCase()}
                </option>
              ))}
            </select>
            <select
              aria-label={ru ? "Порядок планов" : "Жоспарлардың реті"}
              value={sort}
              onChange={(event) => {
                focusResults.current = false;
                setSort(event.target.value);
                setOffset(0);
              }}
            >
              <option value="recent">
                {ru ? "Сначала новые" : "Алдымен жаңалары"}
              </option>
              <option value="name">
                {ru ? "По названию" : "Атауы бойынша"}
              </option>
            </select>
          </div>
          <section
            className="card plan-list"
            aria-label={t.plans}
            aria-busy={loading}
          >
            <div className="collection-caption" ref={caption} tabIndex={-1}>
              <span>{ru ? "Учебные планы" : "Оқу жоспарлары"}</span>
              <span aria-live="polite">
                {loading && !ready
                  ? t.loading
                  : error
                    ? "—"
                    : page?.matched
                      ? `${page.offset + 1}–${page.offset + visible.length} / ${page.matched}`
                      : "0"}
              </span>
            </div>
            {loading && !ready ? (
              <div className="empty-state" role="status">
                <span className="spinner" />
                {t.loading}
              </div>
            ) : error || !ready ? null : visible.length ? (
              visible.map((plan) => (
                <div className="resource-row" key={plan.id}>
                  <span className="file-icon">
                    <FileText size={21} strokeWidth={1.5} />
                  </span>
                  <button
                    className="resource-text text-button resource-open"
                    onClick={() => onOpen(plan)}
                  >
                    <strong>{plan.title}</strong>
                    <small>
                      {plan.grade
                        ? `${plan.grade} ${t.grade.toLowerCase()} · `
                        : ""}
                      {plan.school_year ||
                        (ru
                          ? "Учебный год не указан"
                          : "Оқу жылы көрсетілмеген")}
                    </small>
                  </button>
                  <span
                    className={`badge ${plan.status === "confirmed" ? "green" : ["failed", "cancelled"].includes(plan.status) ? "red" : "gold"}`}
                  >
                    {(t as unknown as Record<string, string>)[plan.status] ||
                      (isReview(plan) ? t.review : t.processing)}
                  </span>
                  <button
                    className="icon-button"
                    onClick={() => onRemove(plan.id)}
                    aria-label={t.remove}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => onOpen(plan)}
                    aria-label={t.select}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Search size={28} className="muted" />
                <h3>
                  {ru ? "Таких планов пока нет" : "Мұндай жоспарлар әзірге жоқ"}
                </h3>
                <p>
                  {ru
                    ? "Попробуйте другое название или сбросьте фильтры."
                    : "Басқа атауды іздеңіз немесе сүзгілерді тазалаңыз."}
                </p>
                <button className="button secondary" onClick={reset}>
                  <X size={16} />
                  {ru ? "Сбросить фильтры" : "Сүзгілерді тазалау"}
                </button>
              </div>
            )}
          </section>
          {ready && !error && page && page.matched > page.limit && (
            <nav
              className="collection-pagination actions"
              aria-label={
                ru ? "Страницы списка планов" : "Жоспарлар тізімінің беттері"
              }
            >
              <button
                type="button"
                className="button secondary"
                disabled={page.offset === 0}
                onClick={() => {
                  focusResults.current = true;
                  setOffset(Math.max(0, page.offset - page.limit));
                }}
              >
                {ru ? "Назад" : "Артқа"}
              </button>
              <span>
                {ru ? "Страница" : "Бет"}{" "}
                {Math.floor(page.offset / page.limit) + 1} /{" "}
                {Math.ceil(page.matched / page.limit)}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page.offset + page.limit >= page.matched}
                onClick={() => {
                  focusResults.current = true;
                  setOffset(page.offset + page.limit);
                }}
              >
                {ru ? "Далее" : "Келесі"}
              </button>
            </nav>
          )}
          {onDemo && (
            <button
              className="text-button collection-demo"
              onClick={onDemo}
              disabled={busy}
            >
              {t.demo}
              <ArrowUpRight size={14} />
            </button>
          )}
        </>
      ) : (
        <section className="first-plan card">
          <div className="first-plan-art" aria-hidden="true">
            <span>
              <FileText size={34} strokeWidth={1.2} />
            </span>
            <i />
            <i />
            <i />
            <span className="first-plan-stamp">КТЖ / КТП</span>
          </div>
          <div>
            <span className="eyebrow">
              {ru ? "Начнём с вашего плана" : "Жоспарыңыздан бастайық"}
            </span>
            <h2>{t.empty}</h2>
            <p>{t.emptySub}</p>
            <div className="actions">
              <button className="button primary" onClick={onUpload}>
                <FolderOpen size={17} />
                {t.upload}
              </button>
              {onDemo && (
                <button
                  className="button secondary"
                  onClick={onDemo}
                  disabled={busy}
                >
                  {busy ? t.loading : t.demo}
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
            <small>
              {ru
                ? "PDF, DOCX, XLS, XLSX · до 25 МБ"
                : "PDF, DOCX, XLS, XLSX · 25 МБ дейін"}
            </small>
          </div>
        </section>
      )}
    </>
  );
}
