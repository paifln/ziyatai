"use client";
import { useConfirm } from "./ui/ConfirmProvider";
import { useState } from "react";
import {
  Download,
  FileText,
  Trash2,
  ArrowRight,
  Search,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useAccountApi } from "../lib/account-client";
import { usePolling, useResume } from "../lib/use-polling";
import { useCollectionRead } from "../lib/use-collection-read";
import type { Texts, UiLocale } from "../lib/i18n";
import {
  materialStatuses,
  type MaterialSummary,
  type MaterialCollectionPage,
} from "../../../packages/contracts/material-collection";
export default function ResourceCollection({
  kind,
  t,
  locale,
  onOpen,
  onCreate,
  refresh,
}: {
  kind: "history" | "library";
  t: Texts;
  locale: UiLocale;
  onOpen: (id: string) => void;
  onCreate: () => void;
  refresh: () => Promise<void>;
}) {
  const api = useAccountApi();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const search = query.trim();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("recent");
  const [format, setFormat] = useState("");
  const [audience, setAudience] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [removing, setRemoving] = useState("");
  const params = new URLSearchParams({
    q: search,
    limit: "20",
    offset: String(offset),
    sort,
  });
  if (status) params.set("status", status);
  if (kind === "library" && format) params.set("format", format);
  if (kind === "library" && audience) params.set("audience", audience);
  const collection = useCollectionRead<MaterialCollectionPage>(
    `${kind}/collection?${params}`,
    0,
    search ? 300 : 0,
  );
  const page = collection.data;
  const items = page?.items ?? [];
  const more = !!page && page.offset + page.limit < page.matched;
  const { loading, reload } = collection;
  const error = mutationError || collection.error;
  function resetFilters() {
    setQuery("");
    setStatus("");
    setFormat("");
    setAudience("");
    setOffset(0);
  }
  usePolling(
    reload,
    items.some((i) => ["queued", "running"].includes(i.status)),
    5000,
  );
  useResume(reload);
  async function remove(item: MaterialSummary) {
    if (!(await confirm(t.deleteConfirm, { destructive: true }))) return;
    setRemoving(item.id);
    setMutationError("");
    try {
      await api(
        `${kind === "history" ? "generations" : "exports"}/${item.id}`,
        "DELETE",
      );
      await reload();
      await refresh();
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setRemoving("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t[kind]}</h1>
          <p>
            {kind === "history"
              ? t.createSub
              : locale === "ru"
                ? "Готовые материалы для урока. DOCX и PDF."
                : "Сабаққа дайын материалдар. DOCX және PDF."}
          </p>
        </div>
        <div className="actions">
          <button
            className="icon-button"
            disabled={loading}
            onClick={() => void reload()}
            aria-label={locale === "ru" ? "Обновить список" : "Тізімді жаңарту"}
          >
            <RefreshCw size={17} />
          </button>
          <button className="button primary" onClick={onCreate}>
            <Plus size={17} />
            {t.create}
          </button>
        </div>
      </div>
      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">{t.search}</span>
          <Search size={17} />
          <input
            type="search"
            maxLength={200}
            value={query}
            placeholder={t.search}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <select
          aria-label={
            locale === "ru" ? "Статус материалов" : "Материалдар күйі"
          }
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">
            {locale === "ru" ? "Все статусы" : "Барлық күйлер"}
          </option>
          {materialStatuses
            .filter(
              (value) => (page?.counts[value] ?? 0) > 0 || status === value,
            )
            .map((value) => (
              <option key={value} value={value}>
                {value === "needs_review"
                  ? t.review
                  : ((t as unknown as Record<string, string>)[value] ??
                    value)}{" "}
                · {page?.counts[value] ?? 0}
              </option>
            ))}
        </select>
        {kind === "library" && (
          <>
            <select
              aria-label={locale === "ru" ? "Формат файлов" : "Файл пішімі"}
              value={format}
              onChange={(event) => {
                setFormat(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">
                {locale === "ru" ? "Все форматы" : "Барлық пішімдер"}
              </option>
              <option value="docx">DOCX</option>
              <option value="pdf">PDF</option>
            </select>
            <select
              aria-label={
                locale === "ru" ? "Аудитория листов" : "Парақтар аудиториясы"
              }
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">
                {locale === "ru" ? "Все листы" : "Барлық парақтар"}
              </option>
              <option value="student">{t.student}</option>
              <option value="full">{t.full}</option>
            </select>
          </>
        )}
        <select
          aria-label={
            locale === "ru" ? "Порядок материалов" : "Материалдар реті"
          }
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setOffset(0);
          }}
        >
          <option value="recent">
            {locale === "ru" ? "Сначала новые" : "Алдымен жаңалары"}
          </option>
          <option value="name">
            {locale === "ru" ? "По названию" : "Атауы бойынша"}
          </option>
        </select>
        {(query || status || format || audience) && (
          <button type="button" className="text-button" onClick={resetFilters}>
            {locale === "ru" ? "Сбросить фильтры" : "Сүзгілерді тазалау"}
          </button>
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              setMutationError("");
              void reload();
            }}
          >
            {t.retry}
          </button>
        </div>
      )}
      <section className="card" aria-busy={loading}>
        <div className="collection-caption" role="status" aria-live="polite">
          <span>{t[kind]}</span>
          <span>
            {!collection.ready
              ? loading
                ? t.loading
                : "—"
              : page?.matched
                ? `${page.offset + 1}–${page.offset + items.length} / ${page.matched}`
                : "0"}
          </span>
        </div>
        {loading && !items.length ? (
          <div className="inline-loading" role="status">
            {t.loading}
          </div>
        ) : (
          <>
            {!items.length && collection.ready && !collection.error && (
              <div className="empty-state">
                <FileText size={32} />
                <h2>
                  {search || status || format || audience
                    ? locale === "ru"
                      ? "Ничего не найдено"
                      : "Ештеңе табылмады"
                    : t.empty}
                </h2>
                <p>
                  {search || status || format || audience
                    ? locale === "ru"
                      ? "Попробуйте другое название или очистите поиск."
                      : "Басқа атауды енгізіңіз немесе іздеуді тазалаңыз."
                    : t.createSub}
                </p>
                {(search || status || format || audience) && (
                  <button className="button" onClick={resetFilters}>
                    {locale === "ru"
                      ? "Сбросить фильтры"
                      : "Сүзгілерді тазалау"}
                  </button>
                )}
              </div>
            )}
            {items.map((item) => (
              <div className="resource-row" key={item.id}>
                <div className="file-icon">
                  <FileText size={20} />
                </div>
                {kind === "history" ? (
                  <button
                    className="resource-text text-button resource-open"
                    onClick={() => onOpen(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {new Date(item.created_at).toLocaleDateString(
                        locale === "ru" ? "ru-RU" : "kk-KZ",
                      )}
                      {item.demo ? ` · ${t.demoLabel}` : ""}
                    </small>
                  </button>
                ) : (
                  <div className="resource-text">
                    <strong>{item.title}</strong>
                    <small>
                      {item.format?.toUpperCase()} ·{" "}
                      {item.audience === "student" ? t.student : t.full} ·{" "}
                      {t.versions} {item.revision}
                      {" · "}
                      {item.teacher_reviewed
                        ? locale === "ru"
                          ? "Проверено учителем"
                          : "Мұғалім тексерді"
                        : locale === "ru"
                          ? "Черновик"
                          : "Жоба"}
                    </small>
                  </div>
                )}
                <span
                  className={`badge ${["succeeded", "approved"].includes(item.status) ? "green" : ["failed", "cancelled"].includes(item.status) ? "red" : "gold"}`}
                >
                  {(t as unknown as Record<string, string>)[item.status] ||
                    (item.status === "needs_review" ? t.review : t.processing)}
                </span>
                {kind === "library" &&
                  item.status === "succeeded" &&
                  item.teacher_reviewed && (
                    <a
                      className="icon-button"
                      href={`/api/exports/${item.id}/download`}
                      aria-label={`${t.download}: ${item.title}`}
                    >
                      <Download size={17} />
                    </a>
                  )}
                {kind === "library" && !item.teacher_reviewed && (
                  <button
                    className="text-button"
                    onClick={() =>
                      item.generation_id && onOpen(item.generation_id)
                    }
                  >
                    {locale === "ru"
                      ? "Проверить задания"
                      : "Тапсырмаларды тексеру"}
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={() => void remove(item)}
                  disabled={!!removing || !collection.ready}
                  aria-label={`${t.remove}: ${item.title}`}
                >
                  <Trash2 size={16} />
                </button>
                {kind === "history" && (
                  <button
                    className="icon-button"
                    onClick={() => onOpen(item.id)}
                    aria-label={`${t.select}: ${item.title}`}
                  >
                    <ArrowRight size={17} />
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </section>
      {page &&
        collection.ready &&
        !collection.error &&
        (page.offset > 0 || more) && (
          <nav
            className="pagination"
            aria-label={
              locale === "ru" ? "Страницы материалов" : "Материалдар беттері"
            }
          >
            <button
              className="button secondary"
              disabled={page.offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, page.offset - page.limit))}
            >
              {t.back}
            </button>
            <span>
              {Math.floor(page.offset / page.limit) + 1} /{" "}
              {Math.ceil(page.matched / page.limit)}
            </span>
            <button
              className="button secondary"
              disabled={!more || loading}
              onClick={() => setOffset(page.offset + page.limit)}
            >
              {locale === "ru" ? "Далее" : "Келесі"}
            </button>
          </nav>
        )}
    </>
  );
}
