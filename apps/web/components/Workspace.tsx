"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard,
  Files,
  Sparkles,
  History,
  Library,
  Settings,
  LogOut,
  Upload,
  ArrowRight,
  ChevronRight,
  BookOpen,
  FileText,
  Clock,
  Search,
  Menu,
  Plus,
  Check,
  Download,
  Trash2,
  AlertTriangle,
  X,
  Layers,
} from "lucide-react";
import { api, authClient } from "../lib/client";
import { dictionary, type UiLocale, type Texts } from "../lib/i18n";
import AuthPanel from "./AuthPanel";
import PlanReview from "./PlanReview";
import GenerationEditor from "./GenerationEditor";
import { displayLevel } from "../../../packages/domain/validation";
const nav = [
  { key: "overview", icon: LayoutDashboard },
  { key: "plans", icon: Files },
  { key: "create", icon: Sparkles },
  { key: "history", icon: History },
  { key: "library", icon: Library },
  { key: "profile", icon: Settings },
] as const;
type View = (typeof nav)[number]["key"] | "upload" | "review" | "editor";
export default function Workspace() {
  const [locale, setLocaleState] = useState<UiLocale>("kk");
  const t = dictionary[locale];
  const { data: session, isPending } = authClient.useSession();
  const [view, setView] = useState<View>("overview"),
    [menu, setMenu] = useState(false),
    [profile, setProfile] = useState<any>(),
    [plans, setPlans] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [library, setLibrary] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const setLocale = useCallback((l: UiLocale) => {
    setLocaleState(l);
    document.documentElement.lang = l;
    document.cookie = `ziyatai-locale=${l}; Path=/; SameSite=Lax; Max-Age=31536000`;
  }, []);
  useEffect(() => {
    const cookie = document.cookie.match(
      /(?:^|; )ziyatai-locale=(kk|ru)/,
    )?.[1] as UiLocale | undefined;
    if (cookie) setLocale(cookie);
  }, [setLocale]);
  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const data = await Promise.all([
        api("profile"),
        api("ktp?limit=100"),
        api("history?limit=100"),
        api("library?limit=100"),
        api("jobs"),
      ]);
      setProfile(data[0]);
      setPlans(data[1]);
      setHistory(data[2]);
      setLibrary(data[3]);
      setJobs(data[4]);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [session, refresh]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function navigate(next: View, id = "") {
    setView(next);
    setSelected(id);
    setMenu(false);
    setError("");
    setQuery("");
    window.scrollTo(0, 0);
  }
  async function demo() {
    setBusy(true);
    try {
      const result = await api("demo", "POST", { locale });
      await refresh();
      navigate("editor", result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(resource: string, id: string) {
    if (!window.confirm(t.deleteConfirm)) return;
    try {
      await api(`${resource}/${id}`, "DELETE");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const badge = (status: string) => (
    <span
      className={`badge ${status === "confirmed" || status === "succeeded" ? "green" : ["failed", "cancelled"].includes(status) ? "red" : "gold"}`}
    >
      {(t as any)[status] ??
        (status === "needs_review" || status === "review"
          ? t.review
          : t.processing)}
    </span>
  );
  const openPlan = (p: any) => navigate("review", p.id);
  const planRows = (data: any[]) => (
    <>
      {data.map((p) => (
        <div className="resource-row" key={p.id}>
          <div className="file-icon">
            <FileText size={20} />
          </div>
          <button
            className="resource-text text-button"
            style={{ textAlign: "left", color: "inherit" }}
            onClick={() => openPlan(p)}
          >
            <strong>{p.title}</strong>
            <small>
              {p.grade ? `${p.grade} ${t.grade.toLowerCase()} · ` : ""}
              {p.school_year ||
                new Date(p.created_at).toLocaleDateString(
                  locale === "kk" ? "kk-KZ" : "ru-RU",
                )}
            </small>
          </button>
          {badge(p.status)}
          <button
            className="icon-button"
            onClick={() => openPlan(p)}
            aria-label={t.select}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ))}
    </>
  );
  if (isPending)
    return (
      <div className="loading-screen">
        <div>
          <img src="/owl.svg" width="42" height="42" alt="ZiyatAI" />
          <span className="spinner" />
          <span>{t.loading}</span>
        </div>
      </div>
    );
  if (!session)
    return <AuthPanel t={t} locale={locale} setLocale={setLocale} />;
  const title =
    view==='review'?t.plans:view==='editor'?t.editor:(t as any)[view]??t.upload;
  return (
    <>
      <button
        className={`mobile-overlay ${menu ? "open" : ""}`}
        onClick={() => setMenu(false)}
        aria-label={t.cancel}
      />
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a href="/" className="brand">
          <img src="/owl.svg" width="40" height="40" alt="" />
          <span>
            Ziyat<span className="brand-ai">AI</span>
          </span>
        </a>
        <div className="sidebar-label">{t.workspace}</div>
        <nav className="nav-list" aria-label={t.workspace}>
          {nav.map(({ key, icon: Icon }) => (
            <button
              className={`nav-link ${view === key || (key === "plans" && ["upload", "review"].includes(view)) || (key === "history" && view === "editor") ? "active" : ""}`}
              key={key}
              onClick={() => navigate(key)}
            >
              <Icon size={19} />
              <span>{t[key]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-mini">
            <div className="avatar">
              {session.user.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{session.user.name}</strong>
              <small>
                {locale === "ru"
                  ? "Учитель информатики"
                  : "Информатика мұғалімі"}
              </small>
            </div>
          </div>
          <button
            className="nav-link"
            onClick={async () => {
              await authClient.signOut();
              window.location.assign("/");
            }}
          >
            <LogOut size={16} />
            {t.logout}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              onClick={() => setMenu(true)}
              aria-label={t.workspace}
            >
              <Menu size={18} />
            </button>
            <span>{t.workspace}</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <div className="language-switch">
              <button
                className={locale === "kk" ? "active" : ""}
                onClick={() => setLocale("kk")}
              >
                ҚАЗ
              </button>
              <button
                className={locale === "ru" ? "active" : ""}
                onClick={() => setLocale("ru")}
              >
                РУС
              </button>
            </div>
            <button
              className="avatar"
              style={{ border: 0 }}
              onClick={() => navigate("profile")}
              aria-label={t.profile}
            >
              {session.user.name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="notice error global-error" role="alert">
              {error}
              <button
                className="text-button"
                style={{ float: "right" }}
                onClick={() => setError("")}
                aria-label={t.cancel}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="inline-loading">
              <span className="spinner" /> {t.loading}
              {error && (
                <div>
                  <button
                    className="button mt-20"
                    onClick={() => void refresh()}
                  >
                    {t.retry}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="small-label">
                        {locale === "ru" ? "Здравствуйте" : "Сәлем"},{" "}
                        {session.user.name.split(" ")[0]}
                      </span>
                      <h1 className="mt-20" style={{ marginTop: 9 }}>
                        {t.welcome}
                      </h1>
                      <p>{t.welcomeSub}</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => navigate("upload")}
                    >
                      <Plus size={17} />
                      {t.upload}
                    </button>
                  </div>
                  <div className="stats-grid">
                    {[
                      [Files, t.planCount, plans.length, ""],
                      [
                        Clock,
                        t.reviewCount,
                        plans.filter((p) => p.status === "review").length,
                        "gold",
                      ],
                      [
                        Library,
                        t.documentCount,
                        library.filter((d) => d.status === "succeeded").length,
                        "blue",
                      ],
                    ].map(([Icon, label, count, color], i) => {
                      const I = Icon as typeof Files;
                      return (
                        <div className="stat-card" key={i}>
                          <div className={`stat-icon ${color}`}>
                            <I size={22} />
                          </div>
                          <div>
                            <small>{label as string}</small>
                            <strong>{count as number}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="dashboard-grid">
                    <div>
                      <section className="card">
                        <div className="card-heading">
                          <h2>{t.recentPlans}</h2>
                          <button
                            className="text-button"
                            onClick={() => navigate("plans")}
                          >
                            {t.all} <span aria-hidden="true">→</span>
                          </button>
                        </div>
                        {plans.length ? (
                          <>
                            {planRows(plans.slice(0, 4))}
                            {profile.capabilities.demo && (
                              <button
                                className="text-button mt-20"
                                onClick={demo}
                                disabled={busy}
                              >
                                {t.demo}
                              </button>
                            )}
                          </>
                        ) : (
                          <Empty
                            t={t}
                            onUpload={() => navigate("upload")}
                            onDemo={
                              profile.capabilities.demo ? demo : undefined
                            }
                            busy={busy}
                          />
                        )}
                      </section>
                      <section className="card">
                        <div className="card-heading">
                          <h2>{t.recentDocs}</h2>
                          <button
                            className="text-button"
                            onClick={() => navigate("library")}
                          >
                            {t.all} →
                          </button>
                        </div>
                        {library.filter((d) => d.status === "succeeded")
                          .length ? (
                          library
                            .filter((d) => d.status === "succeeded")
                            .slice(0, 3)
                            .map((d) => (
                              <div key={d.id} className="resource-row">
                                <div className="file-icon">
                                  <FileText size={20} />
                                </div>
                                <div className="resource-text">
                                  <strong>{d.title}</strong>
                                  <small>
                                    {d.format.toUpperCase()} ·{" "}
                                    {d.audience === "student"
                                      ? t.student
                                      : t.full}
                                  </small>
                                </div>
                                <a
                                  className="icon-button"
                                  href={`/api/exports/${d.id}/download`}
                                  aria-label={t.download}
                                >
                                  <Download size={16} />
                                </a>
                              </div>
                            ))
                        ) : (
                          <p
                            className="muted"
                            style={{ fontSize: 12, marginBottom: 0 }}
                          >
                            {t.emptySub}
                          </p>
                        )}
                      </section>
                    </div>
                    <div>
                      <div className="hero-card">
                        <span className="eyebrow">
                          {locale === "ru" ? "ПЛАН → УРОК" : "ЖОСПАР → САБАҚ"}
                        </span>
                        <h2 className="mt-20">{t.create}</h2>
                        <p>{t.createSub}</p>
                        <button
                          className="button"
                          onClick={() => navigate("create")}
                        >
                          {t.create}
                          <ArrowRight size={15} />
                        </button>
                        <Layers size={110} className="hero-icon" />
                      </div>
                      <section className="card">
                        <h2>{t.start}</h2>
                        {[
                          [t.step1, t.step1Sub],
                          [t.step2, t.step2Sub],
                          [t.step3, t.step3Sub],
                        ].map(([heading, sub], i) => (
                          <div className="step" key={i}>
                            <span className="step-number">{i + 1}</span>
                            <div>
                              <strong>{heading}</strong>
                              <p>{sub}</p>
                            </div>
                          </div>
                        ))}
                      </section>
                    </div>
                  </div>
                  {jobs.some((j) =>
                    ["queued", "running", "failed"].includes(j.status),
                  ) && (
                    <section className="card">
                      <h2>{t.jobs}</h2>
                      <Jobs
                        jobs={jobs
                          .filter((j) =>
                            ["queued", "running", "failed"].includes(j.status),
                          )
                          .slice(0, 5)}
                        t={t}
                        onOpen={(j) =>
                          navigate(
                            j.kind === "import" ? "review" : "editor",
                            j.resource_id,
                          )
                        }
                        refresh={refresh}
                      />
                    </section>
                  )}
                </>
              )}
              {view === "plans" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>{t.plans}</h1>
                      <p>{t.uploadSub}</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => navigate("upload")}
                    >
                      <Plus size={17} />
                      {t.upload}
                    </button>
                  </div>
                  <SearchBar t={t} query={query} setQuery={setQuery} />
                  <section className="card">
                    {plans.length ? (
                      plans
                        .filter((p) =>
                          p.title.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((p) => (
                          <div key={p.id}>
                            <div className="resource-row">
                              <div className="file-icon">
                                <FileText size={20} />
                              </div>
                              <button
                                className="resource-text text-button"
                                style={{ textAlign: "left", color: "inherit" }}
                                onClick={() => openPlan(p)}
                              >
                                <strong>{p.title}</strong>
                                <small>
                                  {p.grade
                                    ? `${p.grade} ${t.grade.toLowerCase()} · `
                                    : ""}
                                  {p.school_year}
                                </small>
                              </button>
                              {badge(p.status)}
                              <button
                                className="icon-button"
                                onClick={() => remove("ktp", p.id)}
                                aria-label={t.remove}
                              >
                                <Trash2 size={15} />
                              </button>
                              <button
                                className="icon-button"
                                onClick={() => openPlan(p)}
                                aria-label={t.select}
                              >
                                <ChevronRight size={16} />
                              </button>
                            </div>
                          </div>
                        ))
                    ) : (
                      <Empty
                        t={t}
                        onUpload={() => navigate("upload")}
                        onDemo={profile.capabilities.demo ? demo : undefined}
                        busy={busy}
                      />
                    )}
                  </section>
                </>
              )}
              {view === "upload" && (
                <UploadPanel
                  t={t}
                  locale={locale}
                  onDone={async (id) => {
                    await refresh();
                    navigate("review", id);
                  }}
                  onError={setError}
                />
              )}
              {view === "review" && (
                <PlanReview
                  key={selected}
                  id={selected}
                  t={t}
                  locale={locale}
                  onError={setError}
                  onSaved={() => {
                    setToast(t.saved);
                    void refresh();
                  }}
                  onGenerate={() => navigate("create", selected)}
                  jobs={jobs}
                  refresh={refresh}
                />
              )}
              {view === "create" && (
                <GeneratePanel
                  t={t}
                  locale={locale}
                  plans={plans}
                  selected={selected}
                  aiAvailable={profile.capabilities.ai}
                  quota={profile.limits.daily}
                  onError={setError}
                  onDone={async (id) => {
                    await refresh();
                    navigate("editor", id);
                  }}
                  onReview={(id) => navigate("review", id)}
                />
              )}
              {view === "editor" && (
                <GenerationEditor
                  key={selected}
                  id={selected}
                  t={t}
                  locale={locale}
                  jobs={jobs}
                  profileStyles={profile.styles}
                  onError={setError}
                  onSaved={() => {
                    setToast(t.saved);
                    void refresh();
                  }}
                  refresh={refresh}
                />
              )}
              {view === "history" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>{t.history}</h1>
                      <p>{t.createSub}</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => navigate("create")}
                    >
                      <Sparkles size={16} />
                      {t.create}
                    </button>
                  </div>
                  <SearchBar t={t} query={query} setQuery={setQuery} />
                  <section className="card">
                    {history.length ? (
                      history
                        .filter((g) =>
                          g.title.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((g) => (
                          <div className="resource-row" key={g.id}>
                            <div className="file-icon">
                              <BookOpen size={20} />
                            </div>
                            <button
                              className="resource-text text-button"
                              style={{ textAlign: "left", color: "inherit" }}
                              onClick={() => navigate("editor", g.id)}
                            >
                              <strong>{g.title}</strong>
                              <small>
                                {g.locale} · {t.versions} {g.revision} ·{" "}
                                {new Date(g.created_at).toLocaleDateString(
                                  locale === "ru" ? "ru-RU" : "kk-KZ",
                                )}
                                {g.demo ? ` · ${t.demoLabel}` : ""}
                              </small>
                            </button>
                            {badge(g.status)}
                            <button
                              className="icon-button"
                              onClick={() => remove("generations", g.id)}
                              aria-label={t.remove}
                            >
                              <Trash2 size={15} />
                            </button>
                            <button
                              className="icon-button"
                              onClick={() => navigate("editor", g.id)}
                              aria-label={t.select}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        ))
                    ) : (
                      <Empty t={t} onUpload={() => navigate("upload")} />
                    )}
                  </section>
                </>
              )}
              {view === "library" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>{t.library}</h1>
                      <p>DOCX · PDF</p>
                    </div>
                  </div>
                  <SearchBar t={t} query={query} setQuery={setQuery} />
                  <section className="card">
                    {library.length ? (
                      library
                        .filter((d) =>
                          d.title.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((d) => (
                          <div key={d.id} className="resource-row">
                            <div className="file-icon">
                              <FileText size={20} />
                            </div>
                            <div className="resource-text">
                              <strong>{d.title}</strong>
                              <small>
                                {d.format.toUpperCase()} ·{" "}
                                {d.audience === "student" ? t.student : t.full}{" "}
                                · {t.versions} {d.revision}
                              </small>
                            </div>
                            {badge(d.status)}
                            {d.status === "succeeded" && (
                              <a
                                className="icon-button"
                                href={`/api/exports/${d.id}/download`}
                                aria-label={t.download}
                              >
                                <Download size={16} />
                              </a>
                            )}
                            <button
                              className="icon-button"
                              onClick={() => remove("exports", d.id)}
                              aria-label={t.remove}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))
                    ) : (
                      <Empty t={t} onUpload={() => navigate("upload")} />
                    )}
                  </section>
                </>
              )}
              {view === "profile" && (
                <ProfilePanel
                  t={t}
                  profile={profile}
                  onError={setError}
                  onSaved={() => {
                    setToast(t.saved);
                    void refresh();
                  }}
                  setLocale={setLocale}
                />
              )}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check
            size={14}
            style={{ verticalAlign: "middle", marginRight: 8 }}
          />
          {toast}
        </div>
      )}
    </>
  );
}
export function SearchBar({
  t,
  query,
  setQuery,
}: {
  t: Texts;
  query: string;
  setQuery: (q: string) => void;
}) {
  return (
    <div className="toolbar">
      <label className="search-field">
        <span className="sr-only">{t.search}</span>
        <Search size={16} />
        <input
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
    </div>
  );
}
export function Empty({
  t,
  onUpload,
  onDemo,
  busy,
}: {
  t: Texts;
  onUpload: () => void;
  onDemo?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Files size={28} />
      </div>
      <h3>{t.empty}</h3>
      <p>{t.emptySub}</p>
      <button className="button secondary" onClick={onUpload}>
        <Upload size={15} />
        {t.upload}
      </button>
      {onDemo && (
        <div style={{ marginTop: 14 }}>
          <button className="text-button" onClick={onDemo} disabled={busy}>
            {busy ? t.loading : t.demo}
          </button>
        </div>
      )}
    </div>
  );
}
export function Jobs({
  jobs,
  t,
  onOpen,
  refresh,
}: {
  jobs: any[];
  t: Texts;
  onOpen?: (j: any) => void;
  refresh: () => Promise<void>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      {jobs.map((j) => (
        <div className="job-card" key={j.id}>
          {["running", "queued"].includes(j.status) ? (
            <span className="spinner" />
          ) : j.status === "succeeded" ? (
            <Check size={18} color="#37764e" />
          ) : (
            <AlertTriangle size={18} color="#b06c24" />
          )}
          <div className="job-body">
            <strong>{(t as any)[j.stage] ?? t.processing}</strong>
            <small>
              {(t as any)[j.status] ?? t.processing}
              {j.error_code ? ` · ${t.retry}` : ""}
            </small>
            {errors[j.id] && <div role="alert">{errors[j.id]}</div>}
          </div>
          {["queued", "running"].includes(j.status) ? (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api(`jobs/${j.id}/cancel`, "POST", {});
                  await refresh();
                } catch (e) {
                  setErrors({ ...errors, [j.id]: (e as Error).message });
                }
              }}
            >
              {t.cancel}
            </button>
          ) : (
            onOpen && (
              <button
                className="icon-button"
                onClick={() => onOpen(j)}
                aria-label={t.select}
              >
                <ChevronRight size={16} />
              </button>
            )
          )}
          {["failed", "cancelled"].includes(j.status) &&
            ["import", "export"].includes(j.kind) && (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await api(`jobs/${j.id}/retry`, "POST", {});
                    await refresh();
                  } catch (e) {
                    setErrors({ ...errors, [j.id]: (e as Error).message });
                  }
                }}
              >
                {t.retry}
              </button>
            )}
        </div>
      ))}
    </>
  );
}
function UploadPanel({
  t,
  locale,
  onDone,
  onError,
}: {
  t: Texts;
  locale: UiLocale;
  onDone: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [file, setFile] = useState<File>(),
    [sourceLocale, setSourceLocale] = useState(locale),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploaded = await api("uploads", "POST", form);
      const imported = await api("ktp/imports", "POST", {
        uploadId: uploaded.id,
        locale: sourceLocale,
        includeHidden: hidden,
      });
      onDone(imported.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.newPlan}</h1>
          <p>{t.uploadSub}</p>
        </div>
      </div>
      <section className="card upload-card">
        <form onSubmit={submit}>
          <div className="dropzone">
            <Upload size={32} />
            <h3>{t.drag}</h3>
            <p>{t.formats}</p>
            <label>
              <span className="sr-only">{t.upload}</span>
              <input
                type="file"
                accept=".pdf,.docx,.xls,.xlsx"
                required
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            <p>{t.docNotice}</p>
          </div>
          <label>
            {t.sourceLanguage}
            <select
              value={sourceLocale}
              onChange={(e) => setSourceLocale(e.target.value as UiLocale)}
            >
              <option value="kk">Қазақша</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <label className="checkbox mt-20">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            {t.includeHidden}
          </label>
          <div className="notice">{t.privacy}</div>
          <p style={{ fontSize: 12 }}>{t.policy}</p>
          <button className="button primary wide" disabled={!file || busy}>
            {busy ? (
              <>
                <span className="spinner" />
                {t.importing}
              </>
            ) : (
              <>
                {t.import}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </section>
    </>
  );
}
function GeneratePanel({
  t,
  locale,
  plans,
  selected,
  aiAvailable,
  quota,
  onError,
  onDone,
  onReview,
}: {
  t: Texts;
  locale: UiLocale;
  plans: any[];
  selected: string;
  aiAvailable: boolean;
  quota: number;
  onError: (s: string) => void;
  onDone: (id: string) => void;
  onReview: (id: string) => void;
}) {
  const confirmed = plans.filter((p) => p.status === "confirmed");
  const [planId, setPlanId] = useState(selected || confirmed[0]?.id || ""),
    [plan, setPlan] = useState<any>(),
    [rowId, setRowId] = useState(""),
    [outLocale, setOutLocale] = useState<string>(locale),
    [count, setCount] = useState(3),
    [minutes, setMinutes] = useState(30),
    [constraints, setConstraints] = useState(""),
    [format, setFormat] = useState("mixed"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (planId)
      api(`ktp/${planId}`)
        .then((p) => {
          setPlan(p);
          setRowId(p.rows?.[0]?.id ?? "");
        })
        .catch((e) => onError(e.message));
  }, [planId, onError]);
  const row = plan?.rows?.find((r: any) => r.id === rowId);
  const requestKeys = useRef(new Map<string, string>());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = {
        planId,
        rowId,
        revision: plan.revision,
        locale: outLocale,
        count,
        minutes,
        constraints,
        format,
      };
      const signature = JSON.stringify(data);
      if (!requestKeys.current.has(signature))
        requestKeys.current.set(signature, crypto.randomUUID());
      const g = await api(
        "generations",
        "POST",
        data,
        requestKeys.current.get(signature),
      );
      onDone(g.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.create}</h1>
          <p>{t.createSub}</p>
        </div>
      </div>
      {!confirmed.length ? (
        <section className="card">
          <p>{t.noConfirmed}</p>
          {plans[0] && (
            <button className="button" onClick={() => onReview(plans[0].id)}>
              {t.plans}
              <ArrowRight size={16} />
            </button>
          )}
        </section>
      ) : (
        <div className="generation-layout">
          <section className="card">
            <form onSubmit={submit}>
              <label>
                {t.choosePlan}
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  {confirmed.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-20">
                {t.chooseTopic}
                <select
                  value={rowId}
                  onChange={(e) => setRowId(e.target.value)}
                >
                  {plan?.rows?.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.sourceOrder}. {r.topic}
                    </option>
                  ))}
                </select>
              </label>
              {row && (
                <div className="topic-summary">
                  <span className="badge green">
                    {plan.grade} {t.grade.toLowerCase()} · {t.confirmed}
                  </span>
                  <h3 className="mt-20">{row.topic}</h3>
                  <p>{row.goals}</p>
                </div>
              )}
              <div className="form-grid">
                <label>
                  {t.locale}
                  <select
                    value={outLocale}
                    onChange={(e) => setOutLocale(e.target.value)}
                  >
                    <option value="kk">Қазақша</option>
                    <option value="ru">Русский</option>
                    <option value="kk+ru">Қазақша + Русский</option>
                  </select>
                </label>
                <label>
                  {t.format}
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    {["mixed", "theory", "programming", "logic"].map((f) => (
                      <option key={f} value={f}>
                        {(t as any)[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.count}
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </label>
                <label>
                  {t.minutes}
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
                <label className="span-2">
                  {t.constraints}
                  <textarea
                    value={constraints}
                    maxLength={2000}
                    onChange={(e) => setConstraints(e.target.value)}
                    placeholder={
                      locale === "ru"
                        ? "Например: без доступа к интернету, Python 3.13"
                        : "Мысалы: интернетсіз, Python 3.13"
                    }
                  />
                </label>
              </div>
              {!aiAvailable && (
                <div className="notice warning">{t.aiMissing}</div>
              )}
              <div className="actions">
                <button
                  className="button primary"
                  disabled={
                    !row || busy || !aiAvailable || plan?.status !== "confirmed"
                  }
                >
                  {busy ? t.loading : t.generate}
                  <Sparkles size={16} />
                </button>
              </div>
            </form>
          </section>
          <section className="card" style={{ alignSelf: "start" }}>
            <h2>
              {t.total}: {count * 3}
            </h2>
            {["easy", "medium", "advanced"].map((level, i) => (
              <div key={level} className="level-preview">
                <span className={`level-dot dot-${i}`} />
                <strong>{displayLevel(level, locale)}</strong>
                <small>
                  {count} {locale === "ru" ? "задания" : "тапсырма"}
                </small>
              </div>
            ))}
            <p className="mt-20" style={{ fontSize: 12 }}>
              {t.quota}: {quota}
            </p>
            <div className="notice">{t.privacy}</div>
            <p style={{ fontSize: 12 }}>{t.teacherWarning}</p>
          </section>
        </div>
      )}
    </>
  );
}
function ProfilePanel({
  t,
  profile,
  onError,
  onSaved,
  setLocale,
}: {
  t: Texts;
  profile: any;
  onError: (s: string) => void;
  onSaved: () => void;
  setLocale: (l: UiLocale) => void;
}) {
  const [form, setForm] = useState({
      ...profile,
      styles: {
        font: "Times New Roman",
        size: 14,
        marginLeft: 3,
        marginRight: 1.5,
        marginTop: 2,
        marginBottom: 2,
        lineSpacing: 1.15,
        answerSpace: true,
        includeLogo: true,
        ...profile.styles,
      },
    }),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.profile}</h1>
        </div>
      </div>
      <section className="card profile-card">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("profile", "PATCH", form);
              setLocale(form.locale);
              onSaved();
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              {t.name}
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              {t.email}
              <input value={form.email} disabled />
            </label>
            <label>
              {t.school}
              <input
                maxLength={200}
                value={form.school}
                onChange={(e) => setForm({ ...form, school: e.target.value })}
              />
            </label>
            <label>
              {t.language}
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
              >
                <option value="kk">Қазақша</option>
                <option value="ru">Русский</option>
              </select>
            </label>
            <label className="span-2">
              {t.preferredGrades}
              <span className="chip-grid">
                {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`grade-chip ${form.grades.includes(n) ? "active" : ""}`}
                    aria-pressed={form.grades.includes(n)}
                    onClick={() =>
                      setForm({
                        ...form,
                        grades: form.grades.includes(n)
                          ? form.grades.filter((g: number) => g !== n)
                          : [...form.grades, n],
                      })
                    }
                  >
                    {n}
                  </button>
                ))}
              </span>
            </label>
            <label>
              {t.font}
              <select
                value={form.styles.font}
                onChange={(e) =>
                  setForm({
                    ...form,
                    styles: { ...form.styles, font: e.target.value },
                  })
                }
              >
                {["Times New Roman", "Arial", "Calibri"].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              {t.fontSize}
              <input
                type="number"
                min={10}
                max={18}
                value={form.styles.size}
                onChange={(e) =>
                  setForm({
                    ...form,
                    styles: { ...form.styles, size: Number(e.target.value) },
                  })
                }
              />
            </label>
          </div>
          <button className="button primary mt-20" disabled={busy}>
            <Check size={16} />
            {busy ? t.loading : t.save}
          </button>
        </form>
        <div className="notice mt-20">{t.privacy}</div>
        <details className="mt-20">
          <summary className="danger">
            {profile.locale === "ru" ? "Удаление аккаунта" : "Аккаунтты жою"}
          </summary>
          <p className="mt-20">
            {profile.locale === "ru"
              ? "Все КТП, задания и документы станут недоступны сразу. Файлы будут удалены фоновой операцией. Копии в резервных архивах истекают через 30 дней."
              : "Барлық КТЖ, тапсырмалар және құжаттар бірден қолжетімсіз болады. Файлдар фондық операция арқылы жойылады. Резервтік көшірмелер 30 күннен кейін жойылады."}
          </p>
          <button
            className="button danger"
            onClick={async () => {
              if (!window.confirm(t.deleteConfirm)) return;
              try {
                await api("account", "DELETE");
                await authClient.signOut();
                window.location.reload();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            {t.remove}
          </button>
        </details>
      </section>
    </>
  );
}
