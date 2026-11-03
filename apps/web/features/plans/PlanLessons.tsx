"use client";
import { Plus, Search } from "lucide-react";
import type { PlanReviewViewState } from "./view-state";
import { PlanLessonTable } from "./PlanLessonTable";
export function PlanLessons({ view }: { view: PlanReviewViewState }) {
  const {
    t,
    locale,
    query,
    setQuery,
    quarter,
    setQuarter,
    sort,
    setSort,
    setPage,
    add,
    quarterOptions,
    visible,
    currentPage,
  } = view;
  return (
    <section className="card">
      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">{t.search}</span>
          <Search size={16} />
          <input
            placeholder={t.search}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          <span className="sr-only">{t.quarter}</span>
          <select
            value={quarter}
            onChange={(e) => {
              setQuarter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">
              {t.quarter}: {t.all}
            </option>
            {quarterOptions.map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t.sort}</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(0);
            }}
          >
            <option value="original">{t.originalOrder}</option>
            <option value="date">{t.dateOrder}</option>
          </select>
        </label>
      </div>
      <PlanLessonTable view={view} />
      {visible.length > 25 && (
        <nav
          className="pagination"
          aria-label={locale === "ru" ? "Страницы КТП" : "КТЖ беттері"}
        >
          <button
            className="button secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            {t.back}
          </button>
          <span>
            {currentPage + 1} / {Math.ceil(visible.length / 25)} ·{" "}
            {visible.length} {locale === "ru" ? "строк" : "жол"}
          </span>
          <button
            className="button secondary"
            disabled={(currentPage + 1) * 25 >= visible.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {locale === "ru" ? "Далее" : "Келесі"}
          </button>
        </nav>
      )}
      <button className="button secondary mt-20" onClick={() => add()}>
        <Plus size={16} />
        {t.addRow}
      </button>
    </section>
  );
}
