"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  LayoutDashboard,
  Files,
  PencilLine,
  History,
  Library,
  Settings,
  LogOut,
  Upload,
  ArrowRight,
  ChevronRight,
  FileText,
  Clock,
  Search,
  Menu,
  Plus,
  Check,
  Download,
  Trash2,
  X,
  Layers,
  RefreshCw,
} from "lucide-react";
import { api, authClient } from "../lib/client";
import { dictionary, type UiLocale, type Texts } from "../lib/i18n";
import AuthPanel from "./AuthPanel";
import { Jobs } from "./Jobs";
import { usePolling, useResume } from "../lib/use-polling";
const ResourceCollection = dynamic(() => import("./ResourceCollection"));
const PlanReview = dynamic(() => import("./PlanReview"));
const GenerationEditor = dynamic(() => import("./GenerationEditor"));
const UploadPanel = dynamic(() => import("./WorkspaceForms").then((m) => m.UploadPanel));
const GeneratePanel = dynamic(() => import("./WorkspaceForms").then((m) => m.GeneratePanel));
const ProfilePanel = dynamic(() => import("./WorkspaceForms").then((m) => m.ProfilePanel));
const nav = [
  { key: "overview", icon: LayoutDashboard },
  { key: "plans", icon: Files },
  { key: "create", icon: PencilLine },
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
    [library, setLibrary] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const openedLink = useRef(false);
  const sidebar = useRef<HTMLElement>(null);
  const discardPrompt = locale === "ru" ? "Есть несохранённые изменения. Уйти без сохранения?" : "Сақталмаған өзгерістер бар. Сақтамай шығу керек пе?";
  const refreshing = useRef(false);
  const refreshQueued = useRef(false);
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
    if (refreshing.current) { refreshQueued.current = true; return; }
    refreshing.current = true;
    try {
      do {
      refreshQueued.current = false;
      const data = await Promise.all([
        api("profile"),
        api("ktp?limit=100"),
        api("library?limit=100"),
        api("jobs"),
      ]);
      setProfile(data[0]);
      setPlans(data[1]);
      setLibrary(data[2]);
      setJobs(data[3]);
      setLoaded(true);
      } while (refreshQueued.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refreshing.current = false;
    }
  }, [session]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePolling(refresh, !!session && jobs.some((j) => ["queued", "running"].includes(j.status)), 5000);
  useResume(refresh,!!session);
  useEffect(() => {
    if (!loaded || openedLink.current) return;
    openedLink.current = true;
    const id = new URLSearchParams(window.location.search).get("generation");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) { setSelected(id); setView("editor"); }
  }, [loaded]);
  useEffect(() => {
    if (!menu) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key === "Tab") {
        const nodes = sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
        if (!nodes?.length) return;
        const first=nodes[0],last=nodes[nodes.length-1];
        if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    sidebar.current?.querySelector<HTMLElement>(".nav-link")?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [menu]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function navigate(next: View, id = "") {
    if (hasChanges && !window.confirm(discardPrompt)) return;
    setHasChanges(false);
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
          <img src="/brand-owl.png" width="42" height="42" alt="ZiyatAI" />
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
      <a className="skip-link" href="#workspace-main">{locale === "ru" ? "К содержимому" : "Мазмұнға өту"}</a>
      <button
        className={`mobile-overlay ${menu ? "open" : ""}`}
        onClick={() => setMenu(false)}
        aria-label={t.cancel}
      />
      <aside ref={sidebar} className={`sidebar ${menu ? "open" : ""}`} role={menu ? "dialog" : undefined} aria-modal={menu ? true : undefined} aria-label={menu ? t.workspace : undefined}>
        <button className="icon-button sidebar-close" onClick={()=>setMenu(false)} aria-label={locale === "ru" ? "Закрыть меню" : "Мәзірді жабу"}><X size={18}/></button>
        <a href="/" className="brand">
          <img src="/brand-owl.png" width="40" height="40" alt="" />
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
              aria-current={view === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <Icon size={19} />
              <span>{t[key]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a className="lite-link" href="/help/">{locale === "ru" ? "Помощь" : "Көмек"} <ArrowRight size={14}/></a>
          <a className="lite-link" href="/lite/">{locale === "ru" ? "Облегчённая версия" : "Жеңілдетілген нұсқа"} <ArrowRight size={14} /></a>
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
              if (hasChanges && !window.confirm(discardPrompt)) return;
              await authClient.signOut();
              window.location.assign("/");
            }}
          >
            <LogOut size={16} />
            {t.logout}
          </button>
        </div>
      </aside>
      <div className="main-shell" inert={menu} aria-hidden={menu || undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              onClick={() => setMenu(true)}
              aria-label={t.workspace}
              aria-expanded={menu}
            >
              <Menu size={18} />
            </button>
            <span>{t.workspace}</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <button className="icon-button" onClick={()=>void refresh()} aria-label={locale === "ru" ? "Обновить данные" : "Деректерді жаңарту"}><RefreshCw size={16}/></button>
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
        <main className="main-content" id="workspace-main" tabIndex={-1}>
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
                  <div className="page-heading dashboard-heading">
                    <div>
                      <span className="small-label greeting">
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
                  <section className="lesson-path" aria-label={t.start}>
                    {[[t.step1, t.step1Sub, "upload"], [t.step2, t.step2Sub, "plans"], [t.step3, t.step3Sub, "create"]].map(([heading, description, destination], index) => (
                      <button key={destination} onClick={() => navigate(destination as View)}>
                        <span className="path-number">0{index + 1}</span>
                        <span><strong>{heading}</strong><small>{description}</small></span>
                        <ArrowRight size={18} />
                      </button>
                    ))}
                  </section>
                  <div className="stats-grid">
                    {[
                      [Files, t.planCount, profile.stats?.planCount ?? plans.length, ""],
                      [
                        Clock,
                        t.reviewCount,
                        profile.stats?.reviewCount ?? plans.filter((p) => p.status === "review").length,
                        "gold",
                      ],
                      [
                        Library,
                        t.documentCount,
                        profile.stats?.documentCount ?? library.filter((d) => d.status === "succeeded").length,
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
                                    {" · "}{d.teacher_reviewed ? (locale === "ru" ? "Проверено учителем" : "Мұғалім тексерді") : (locale === "ru" ? "Черновик" : "Жоба")}
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
                  directUploads={profile.capabilities.directUploads}
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
                  onDirtyChange={setHasChanges}
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
                  onDirtyChange={setHasChanges}
                  onError={setError}
                  onSaved={() => {
                    setToast(t.saved);
                    void refresh();
                  }}
                  refresh={refresh}
                />
              )}
              {(view === "history" || view === "library") && (
                <ResourceCollection key={view} kind={view} t={t} locale={locale} onOpen={(id) => navigate("editor",id)} onCreate={() => navigate("create")} refresh={refresh}/>
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
