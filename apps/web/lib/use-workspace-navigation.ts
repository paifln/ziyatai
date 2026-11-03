"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  readWorkspaceLocation,
  workspaceHref,
  type WorkspaceLocation,
} from "../../../packages/domain/workspace-location";

/** Keep browser history and editor state together, including cancelled Back navigation. */
export function useWorkspaceNavigation(
  dirty: boolean,
  confirmDiscard: () => Promise<boolean>,
  onNavigate: () => void,
) {
  const [location, setLocation] = useState<WorkspaceLocation>({
    view: "plans",
    id: "",
  });
  const options = useRef({ dirty, confirmDiscard, onNavigate });
  const transition = useRef<(next: WorkspaceLocation) => Promise<boolean>>(
    async () => false,
  );
  useEffect(() => {
    options.current = { dirty, confirmDiscard, onNavigate };
  }, [dirty, confirmDiscard, onNavigate]);
  useEffect(() => {
    let index = Number(window.history.state?.ziyataiIndex) || 0;
    let restore: (() => void) | undefined;
    let allowNextPop = false;
    let deciding = false;
    const apply = () => {
      setLocation(readWorkspaceLocation(window.location.search));
      options.current.onNavigate();
    };
    window.history.replaceState(
      { ...window.history.state, ziyataiIndex: index },
      "",
    );
    apply();
    transition.current = async (next) => {
      if (deciding) return false;
      const href = workspaceHref(next);
      if (href === window.location.pathname + window.location.search)
        return false;
      deciding = true;
      try {
        if (options.current.dirty && !(await options.current.confirmDiscard()))
          return false;
        window.history.pushState(
          { ...window.history.state, ziyataiIndex: ++index },
          "",
          href,
        );
        apply();
        return true;
      } finally {
        deciding = false;
      }
    };
    const pop = async (event: PopStateEvent) => {
      if (restore) {
        const resolved = restore;
        restore = undefined;
        resolved();
        return;
      }
      const targetIndex = Number(event.state?.ziyataiIndex) || 0;
      if (!allowNextPop && options.current.dirty && targetIndex !== index) {
        deciding = true;
        const restored = new Promise<void>((resolve) => {
          restore = resolve;
        });
        window.history.go(index - targetIndex);
        await restored;
        try {
          if (await options.current.confirmDiscard()) {
            allowNextPop = true;
            window.history.go(targetIndex - index);
          }
        } finally {
          deciding = false;
        }
        return;
      }
      allowNextPop = false;
      index = targetIndex;
      apply();
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      transition.current = async () => false;
    };
  }, []);
  const navigate = useCallback(
    (next: WorkspaceLocation) => transition.current(next),
    [],
  );
  return { location, navigate };
}
