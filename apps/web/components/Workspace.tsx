"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Files,
  PencilLine,
  History,
  Library,
  Settings,
  LogOut,
  ChevronRight,
  Menu,
  Check,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
  Feather,
  ChevronDown,
} from "lucide-react";
import { authClient } from "../lib/client";
import { AccountClientProvider, useAccountApi } from "../lib/account-client";
import { dictionary, type UiLocale } from "../lib/i18n";
import AuthPanel from "./AuthPanel";
import Landing from "./Landing";
import { ThemeToggle } from "./ui/ThemeToggle";
import { ConfirmProvider, useConfirm } from "./ui/ConfirmProvider";
import { subjectLabel } from "../../../packages/domain/subjects";
import { Jobs } from "./Jobs";
import { PlanCollection } from "./plans/PlanCollection";
import { usePolling, useResume } from "../lib/use-polling";
const ResourceCollection = dynamic(() => import("./ResourceCollection"));
const PlanReview = dynamic(() => import("./PlanReview"));
const GenerationEditor = dynamic(() => import("./GenerationEditor"));
const UploadPanel = dynamic(() =>
  import("./forms/UploadPanel").then((m) => m.UploadPanel),
);
const GeneratePanel = dynamic(() =>
  import("./forms/GeneratePanel").then((m) => m.GeneratePanel),
);
const ProfilePanel = dynamic(() =>
  import("./forms/ProfilePanel").then((m) => m.ProfilePanel),
);
const nav = [
  { key: "plans", icon: Files },
  { key: "create", icon: PencilLine },
  { key: "history", icon: History },
  { key: "library", icon: Library },
] as const;
type View =
  (typeof nav)[number]["key"] | "upload" | "review" | "editor" | "profile";
export default function Workspace({
  authMode,
  initialGuest,
  initialLocale,
}: {
  authMode?: "login" | "signup";
  initialGuest?: boolean;
  initialLocale?: UiLocale;
}) {
  const sessionState = authClient.useSession();
  return (
    <AccountClientProvider
      key={sessionState.data?.user.id ?? "guest"}
      owner={sessionState.data?.user.id}
      onSessionChanged={sessionState.refetch}
    >
      <ConfirmProvider>
        <WorkspaceContent
          sessionState={sessionState}
          authMode={authMode}
          initialGuest={initialGuest}
          initialLocale={initialLocale}
        />
      </ConfirmProvider>
    </AccountClientProvider>
  );
}
function WorkspaceContent({
  sessionState,
  authMode,
  initialGuest,
  initialLocale,
}: {
  sessionState: ReturnType<typeof authClient.useSession>;
  authMode?: "login" | "signup";
  initialGuest?: boolean;
  initialLocale?: UiLocale;
}) {
  const api = useAccountApi();
  const confirm = useConfirm();
  const [locale, setLocaleState] = useState<UiLocale>(initialLocale ?? "kk");
  const t = dictionary[locale];
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch: refetchSession,
  } = sessionState;
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useEffect(() => {
    if (!isPending) setSessionLoaded(true);
  }, [isPending]);
  const [view, setView] = useState<View>("plans"),
    [menu, setMenu] = useState(false),
    [profile, setProfile] = useState<any>(),
    [plansRevision, setPlansRevision] = useState(0),
    [jobs, setJobs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const profileDropdown = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("ziyatai-sidebar") === "collapsed");
    } catch {
      // School browser policies may disable preference storage.
    }
  }, []);
  useEffect(() => {
    if (!profileMenu) return;
    const close = (event: PointerEvent) => {
      if (!profileDropdown.current?.contains(event.target as Node))
        setProfileMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenu(false);
        profileTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [profileMenu]);
  const openedLink = useRef(false);
  const [passwordReset, setPasswordReset] = useState(false);
  useEffect(() => {
    setPasswordReset(new URLSearchParams(window.location.search).has("token"));
  }, []);
  const sidebar = useRef<HTMLElement>(null);
  const discardPrompt =
    locale === "ru"
      ? "Есть несохранённые изменения. Уйти без сохранения?"
      : "Сақталмаған өзгерістер бар. Сақтамай шығу керек пе?";
  const refreshing = useRef(false);
  const refreshAbort = useRef<AbortController | undefined>(undefined);
  const sessionUserId = session?.user.id;
  const refreshQueued = useRef(false);
  useEffect(
    () => () => {
      refreshAbort.current?.abort();
      refreshAbort.current = undefined;
      refreshing.current = false;
      refreshQueued.current = false;
    },
    [],
  );
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
    if (!sessionUserId || passwordReset) return;
    if (refreshing.current) {
      refreshQueued.current = true;
      return;
    }
    refreshing.current = true;
    const controller = new AbortController();
    refreshAbort.current = controller;
    try {
      do {
        refreshQueued.current = false;
        const data = await Promise.all([
          api("profile", "GET", undefined, undefined, controller.signal),
          api("jobs", "GET", undefined, undefined, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setProfile(data[0]);
        setPlansRevision((revision) => revision + 1);
        setJobs(data[1]);
        setLoaded(true);
      } while (refreshQueued.current);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (refreshAbort.current === controller) {
        refreshing.current = false;
        refreshAbort.current = undefined;
      }
    }
  }, [sessionUserId, passwordReset, api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePolling(
    refresh,
    !!session && jobs.some((j) => ["queued", "running"].includes(j.status)),
    5000,
  );
  useResume(refresh, !!session);
  useEffect(() => {
    if (!loaded || openedLink.current) return;
    openedLink.current = true;
    const id = new URLSearchParams(window.location.search).get("generation");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      setSelected(id);
      setView("editor");
    }
  }, [loaded]);
  useEffect(() => {
    if (!menu) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key === "Tab") {
        const nodes = sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled])",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
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
  async function navigate(next: View, id = "") {
    if (hasChanges && !(await confirm(discardPrompt))) return;
    setHasChanges(false);
    setView(next);
    setSelected(id);
    setMenu(false);
    setProfileMenu(false);
    setError("");
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
    if (!(await confirm(t.deleteConfirm, { destructive: true }))) return;
    try {
      await api(`${resource}/${id}`, "DELETE");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const openPlan = (p: any) => navigate("review", p.id);
  if (passwordReset)
    return <AuthPanel t={t} locale={locale} setLocale={setLocale} />;
  if (isPending && !sessionLoaded && initialGuest && !authMode)
    return <Landing locale={locale} setLocale={setLocale} />;
  // Auth actions refresh the anonymous session too. Keep the mounted form:
  // replacing it during that refresh loses the email-code step and inputs.
  if (isPending && !session && !sessionLoaded)
    return (
      <div className="loading-screen">
        <div>
          <img src="/brand-owl.png" width="42" height="42" alt="ZiyatAI" />
          <span className="spinner" />
          <span>{t.loading}</span>
        </div>
      </div>
    );
  if (!session && sessionError && sessionError.status !== 401)
    return (
      <main className="loading-screen session-retry">
        <section className="card" aria-labelledby="session-retry-title">
          <img src="/brand-owl.png" width="42" height="42" alt="ZiyatAI" />
          <h1 id="session-retry-title">
            {locale === "ru"
              ? "Не удалось проверить вход"
              : "Кіру күйін тексеру мүмкін болмады"}
          </h1>
          <p role="alert">
            {locale === "ru"
              ? "Проверка сеанса временно недоступна. Повторите попытку; при ограничении запросов подождите минуту."
              : "Сеансты тексеру уақытша қолжетімсіз. Қайта көріңіз; сұраулар шектелсе, бір минут күтіңіз."}
          </p>
          <div className="actions">
            <button
              className="button primary"
              onClick={() => void refetchSession()}
            >
              {locale === "ru" ? "Повторить проверку" : "Қайта тексеру"}
            </button>
            <button
              className="button secondary"
              onClick={() => setLocale(locale === "ru" ? "kk" : "ru")}
            >
              {locale === "ru" ? "Қазақша" : "Русский"}
            </button>
          </div>
        </section>
      </main>
    );
  if (!session)
    return authMode || passwordReset ? (
      <AuthPanel
        t={t}
        locale={locale}
        setLocale={setLocale}
        initialMode={authMode}
      />
    ) : (
      <Landing locale={locale} setLocale={setLocale} />
    );
  const title =
    view === "review"
      ? t.plans
      : view === "editor"
        ? t.editor
        : ((t as any)[view] ?? t.upload);
  return (
    <>
      <a className="skip-link" href="#workspace-main">
        {locale === "ru" ? "К содержимому" : "Мазмұнға өту"}
      </a>
      <button
        className={`mobile-overlay ${menu ? "open" : ""}`}
        onClick={() => setMenu(false)}
        aria-label={t.cancel}
      />
      <aside
        ref={sidebar}
        className={`sidebar ${menu ? "open" : ""} ${collapsed ? "collapsed" : ""}`}
        role={menu ? "dialog" : undefined}
        aria-modal={menu ? true : undefined}
        aria-label={menu ? t.workspace : undefined}
      >
        <button
          className="icon-button sidebar-close"
          onClick={() => setMenu(false)}
          aria-label={locale === "ru" ? "Закрыть меню" : "Мәзірді жабу"}
        >
          <X size={18} />
        </button>
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
              title={t[key]}
              aria-label={t[key]}
              onClick={() => navigate(key)}
            >
              <Icon size={19} />
              <span>{t[key]}</span>
            </button>
          ))}
        </nav>
        <button
          className="sidebar-collapse icon-button"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            try {
              localStorage.setItem(
                "ziyatai-sidebar",
                next ? "collapsed" : "expanded",
              );
            } catch {
              // The panel remains usable without persistence.
            }
          }}
          aria-label={
            locale === "ru"
              ? collapsed
                ? "Развернуть панель"
                : "Свернуть панель"
              : collapsed
                ? "Панельді ашу"
                : "Панельді жинау"
          }
          title={locale === "ru" ? "Боковая панель" : "Бүйірлік панель"}
        >
          {collapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
        </button>
      </aside>
      <div
        className={`main-shell ${collapsed ? "sidebar-collapsed" : ""}`}
        inert={menu}
        aria-hidden={menu || undefined}
      >
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
            <ThemeToggle locale={locale} />
            <a
              className="button help-button"
              href="/help/"
              aria-label={locale === "ru" ? "Помощь" : "Көмек"}
            >
              <CircleHelp size={17} />
              <span>{locale === "ru" ? "Помощь" : "Көмек"}</span>
            </a>
            <a
              className="icon-button lite-button"
              href="/lite/"
              aria-label={locale === "ru" ? "Лёгкая версия" : "Жеңіл нұсқа"}
              title="Lite"
            >
              <Feather size={18} />
            </a>
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
            <div className="profile-dropdown" ref={profileDropdown}>
              <button
                ref={profileTrigger}
                className="profile-trigger"
                onClick={() => setProfileMenu(!profileMenu)}
                aria-label="Профиль"
                aria-expanded={profileMenu}
                aria-controls="profile-menu"
              >
                <span className="avatar">
                  {session.user.name.slice(0, 1).toUpperCase()}
                </span>
                <ChevronDown size={13} />
              </button>
              {profileMenu && (
                <div id="profile-menu" className="profile-menu">
                  <strong>{session.user.name}</strong>
                  <small>{session.user.email}</small>
                  {profile?.teachingSubject && (
                    <small>
                      {subjectLabel(profile.teachingSubject, locale)}
                    </small>
                  )}
                  <button onClick={() => navigate("profile")}>
                    <Settings size={17} />
                    {locale === "ru" ? "Настройки" : "Баптаулар"}
                  </button>
                  <button
                    onClick={async () => {
                      if (hasChanges && !(await confirm(discardPrompt))) return;
                      await authClient.signOut();
                      window.location.assign("/");
                    }}
                  >
                    <LogOut size={17} />
                    {t.logout}
                  </button>
                </div>
              )}
            </div>
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
              {view === "plans" && (
                <>
                  <Jobs
                    locale={locale}
                    jobs={jobs.filter(
                      (j) =>
                        j.kind === "import" &&
                        ["queued", "running"].includes(j.status),
                    )}
                    t={t}
                    refresh={refresh}
                  />
                  <PlanCollection
                    key={sessionUserId}
                    revision={plansRevision}
                    t={t}
                    locale={locale}
                    onUpload={() => {
                      void navigate("upload");
                    }}
                    onOpen={openPlan}
                    onRemove={(id) => {
                      void remove("ktp", id);
                    }}
                    onDemo={profile.capabilities.demo ? demo : undefined}
                    busy={busy}
                  />
                </>
              )}
              {view === "upload" && (
                <UploadPanel
                  onCancel={() => navigate("plans")}
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
                  onBack={() => navigate("plans")}
                  onDirtyChange={setHasChanges}
                  key={`${session.user.id}:${selected}`}
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
                  key={`${session.user.id}:${selected}`}
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
                <ResourceCollection
                  key={view}
                  kind={view}
                  t={t}
                  locale={locale}
                  onOpen={(id) => navigate("editor", id)}
                  onCreate={() => navigate("create")}
                  refresh={refresh}
                />
              )}
              {view === "profile" && (
                <ProfilePanel
                  locale={locale}
                  onDirtyChange={setHasChanges}
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
        <footer className="site-footer">
          <span>© {new Date().getFullYear()} ZiyatAI</span>
          <a href="/privacy/">
            {locale === "ru" ? "Конфиденциальность" : "Құпиялық"}
          </a>
          <a href="/terms/">
            {locale === "ru" ? "Условия использования" : "Пайдалану шарттары"}
          </a>
          <a href="/cookies/">Cookies</a>
        </footer>
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
