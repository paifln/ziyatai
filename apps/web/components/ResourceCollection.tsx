"use client";
import { useConfirm } from "./ui/ConfirmProvider";
import { useState, useEffect } from "react";
import {
  Download,
  FileText,
  Trash2,
  ArrowRight,
  Search,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api } from "../lib/client";
import { usePolling, useResume } from "../lib/use-polling";
import type { Texts, UiLocale } from "../lib/i18n";

interface Material {
  generation_id?: string;
  id: string;
  title: string;
  status: string;
  created_at: string;
  revision: number;
  demo?: boolean;
  format?: string;
  audience?: string;
  teacher_reviewed?: boolean;
}
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
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<Material[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api(
      `${kind}?q=${encodeURIComponent(search)}&limit=21&offset=${offset}`,
      "GET",
      undefined,
      undefined,
      controller.signal,
    )
      .then((data: Material[]) => {
        if (controller.signal.aborted) return;
        setItems(data.slice(0, 20));
        setMore(data.length > 20);
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [kind, search, offset, revision]);
  const reload = async () => {
    setRevision((v) => v + 1);
  };
  usePolling(
    reload,
    items.some((i) => ["queued", "running"].includes(i.status)),
    5000,
  );
  useResume(reload);
  async function remove(item: Material) {
    if (!(await confirm(t.deleteConfirm, { destructive: true }))) return;
    setRemoving(item.id);
    try {
      await api(
        `${kind === "history" ? "generations" : "exports"}/${item.id}`,
        "DELETE",
      );
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 20));
      else setRevision((v) => v + 1);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
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
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRevision((v) => v + 1)}
          >
            {t.retry}
          </button>
        </div>
      )}
      <section className="card" aria-busy={loading}>
        {loading && !items.length ? (
          <div className="inline-loading" role="status">
            {t.loading}
          </div>
        ) : (
          <>
            {!items.length && (
              <div className="empty-state">
                <FileText size={32} />
                <h2>
                  {search
                    ? locale === "ru"
                      ? "Ничего не найдено"
                      : "Ештеңе табылмады"
                    : t.empty}
                </h2>
                <p>
                  {search
                    ? locale === "ru"
                      ? "Попробуйте другое название или очистите поиск."
                      : "Басқа атауды енгізіңіз немесе іздеуді тазалаңыз."
                    : t.createSub}
                </p>
                {search && (
                  <button className="button" onClick={() => setQuery("")}>
                    {locale === "ru" ? "Очистить поиск" : "Іздеуді тазалау"}
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
                  disabled={!!removing}
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
      {(offset > 0 || more) && (
        <nav
          className="pagination"
          aria-label={
            locale === "ru" ? "Страницы материалов" : "Материалдар беттері"
          }
        >
          <button
            className="button secondary"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {t.back}
          </button>
          <span>{Math.floor(offset / 20) + 1}</span>
          <button
            className="button secondary"
            disabled={!more || loading}
            onClick={() => setOffset(offset + 20)}
          >
            {locale === "ru" ? "Далее" : "Келесі"}
          </button>
        </nav>
      )}
    </>
  );
}
