"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAccountClient } from "../../lib/account-client";
import { dictionary, type UiLocale } from "../../lib/i18n";
import { useConfirm } from "../../components/ui/ConfirmProvider";
import { usePolling, useResume } from "../../lib/use-polling";
import type { View, WorkspaceContentProps } from "./types";
export function useWorkspace({
  sessionState,
  initialLocale,
}: WorkspaceContentProps) {
  const { api, auth: accountAuth } = useAccountClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
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
    setPasswordReset(
      new URLSearchParams(window.location.search).get("auth") === "recovery",
    );
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

  return {
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
  };
}
