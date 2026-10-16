"use client";
import { useEffect } from "react";

export function useUnsavedChanges(
  dirty: boolean,
  notify: (dirty: boolean) => void,
) {
  useEffect(() => {
    notify(dirty);
  }, [dirty, notify]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
}
