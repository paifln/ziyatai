"use client";
import { useMemo, useState } from "react";
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
export interface PlanSummary {
  id: string;
  title: string;
  grade: number | null;
  school_year: string;
  status: string;
  created_at?: string;
}
export function PlanCollection({
  plans,
  t,
  locale,
  onUpload,
  onOpen,
  onRemove,
  onDemo,
  busy,
}: {
  plans: PlanSummary[];
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
  const ru = locale === "ru";
  const isReview = (p: PlanSummary) =>
    ["review", "needs_review"].includes(p.status);
  const visible = useMemo(() => {
    const items = plans.filter(
      (p) =>
        (!grade || String(p.grade) === grade) &&
        (status === "all" ||
          (status === "review"
            ? ["review", "needs_review"].includes(p.status)
            : p.status === status)) &&
        p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
    return sort === "name"
      ? items.sort((a, b) => a.title.localeCompare(b.title, locale))
      : items;
  }, [plans, query, status, grade, sort, locale]);
  const tabs = [
    ["all", ru ? "Все планы" : "Барлық жоспар", plans.length],
    [
      "confirmed",
      t.confirmed,
      plans.filter((p) => p.status === "confirmed").length,
    ],
    ["review", t.review, plans.filter(isReview).length],
  ] as const;
  function reset() {
    setQuery("");
    setGrade("");
    setStatus("all");
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
      {plans.length > 0 ? (
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
                onClick={() => setStatus(value)}
              >
                {label}
                <small>{count}</small>
              </button>
            ))}
          </div>
          <div className="toolbar">
            <label className="search-field">
              <span className="sr-only">
                {ru ? "Найти КТП по названию" : "КТЖ атауы бойынша іздеу"}
              </span>
              <Search size={17} />
              <input
                type="search"
                placeholder={
                  ru ? "Найти КТП по названию…" : "КТЖ атауы бойынша іздеу…"
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label={ru ? "Фильтр по классу" : "Сынып бойынша сүзгі"}
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
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
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">
                {ru ? "Сначала новые" : "Алдымен жаңалары"}
              </option>
              <option value="name">
                {ru ? "По названию" : "Атауы бойынша"}
              </option>
            </select>
          </div>
          <section className="card plan-list" aria-label={t.plans}>
            <div className="collection-caption">
              <span>{ru ? "Учебные планы" : "Оқу жоспарлары"}</span>
              <span aria-live="polite">
                {visible.length} / {plans.length}
              </span>
            </div>
            {visible.length ? (
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
