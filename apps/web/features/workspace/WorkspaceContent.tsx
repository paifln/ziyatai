"use client";
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
import { messages, kazakhMessages } from "../../../../packages/domain/errors";
import AuthPanel from "../../components/AuthPanel";
import Landing from "../../components/Landing";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { subjectLabel } from "../../../../packages/domain/subjects";
import { Jobs } from "../../components/Jobs";
import { PlanCollection } from "../../components/plans/PlanCollection";
import { ConnectionNotice } from "../../components/ui/ConnectionNotice";
import { useWorkspace } from "./useWorkspace";
import type { WorkspaceContentProps } from "./types";
const ResourceCollection = dynamic(
  () => import("../../components/ResourceCollection"),
);
const PlanReview = dynamic(() => import("../../components/PlanReview"));
const GenerationEditor = dynamic(
  () => import("../../components/GenerationEditor"),
);
const UploadPanel = dynamic(() =>
  import("../../components/forms/UploadPanel").then((m) => m.UploadPanel),
);
const GeneratePanel = dynamic(() =>
  import("../../components/forms/GeneratePanel").then((m) => m.GeneratePanel),
);
const ProfilePanel = dynamic(() =>
  import("../../components/forms/ProfilePanel").then((m) => m.ProfilePanel),
);
const nav = [
  { key: "plans", icon: Files },
  { key: "create", icon: PencilLine },
  { key: "history", icon: History },
  { key: "library", icon: Library },
] as const;
export function WorkspaceContent(props: WorkspaceContentProps) {
  const { authMode, initialGuest } = props;
  const {
    accountAuth,
    active,
    confirm,
    locale,
    t,
    session,
    isPending,
    sessionError,
    refetchSession,
    sessionLoaded,
    view,
    menu,
    setMenu,
    profile,
    plansRevision,
    jobs,
    selected,
    error,
    setError,
    toast,
    setToast,
    loaded,
    busy,
    hasChanges,
    setHasChanges,
    collapsed,
    setCollapsed,
    profileMenu,
    setProfileMenu,
    profileTrigger,
    profileDropdown,
    passwordReset,
    sidebar,
    discardPrompt,
    sessionUserId,
    setLocale,
    refresh,
    navigate,
    demo,
    remove,
    openPlan,
  } = useWorkspace(props);
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
                      if (!active.current) return;
                      try {
                        const response = await accountAuth.signOut();
                        if (!active.current) return;
                        if (response.error) {
                          const text =
                            locale === "ru" ? messages : kazakhMessages;
                          setError(
                            text[response.error.code ?? ""] ??
                              (response.error.status === 429
                                ? text.LIMIT
                                : text.INTERNAL),
                          );
                          return;
                        }
                        window.location.assign("/");
                      } catch {
                        if (active.current)
                          setError(
                            (locale === "ru" ? messages : kazakhMessages)
                              .INTERNAL,
                          );
                      }
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
          <ConnectionNotice locale={locale} />
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
