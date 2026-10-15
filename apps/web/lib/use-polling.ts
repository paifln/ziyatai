"use client";
import { useEffect, useRef } from "react";

/** One request at a time; stop work on hidden/offline tabs and after unmount. */
export function usePolling(callback: () => Promise<unknown>, enabled: boolean, delay = 3000) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; }, [callback]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, running = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (stopped || running) return;
      if (document.visibilityState === "visible" && navigator.onLine) {
        running = true;
        try { await latest.current(); } catch { /* The caller owns visible error handling. */ }
        finally { running = false; }
      }
      if (!stopped) timer = setTimeout(tick, delay);
    }
    function resume() {
      if (document.visibilityState !== "visible" || !navigator.onLine || running) return;
      clearTimeout(timer);
      void tick();
    }
    timer = setTimeout(tick, delay);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled, delay]);
}

export function useResume(callback: () => Promise<unknown>, enabled = true) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; },[callback]);
  useEffect(() => {
    if (!enabled) return;
    const resume = () => { if(document.visibilityState === "visible" && navigator.onLine)void latest.current(); };
    document.addEventListener("visibilitychange",resume);
    window.addEventListener("online",resume);
    return () => { document.removeEventListener("visibilitychange",resume); window.removeEventListener("online",resume); };
  },[enabled]);
}
