"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { UiLocale } from "../../lib/i18n";

export function ThemeToggle({ locale }: { locale: UiLocale }) {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const sync = () =>
      setTheme(document.documentElement.getAttribute("data-theme") || "light");
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => {
      try {
        if (localStorage.getItem("ziyatai-theme")) return;
      } catch {
        /* Storage is optional. */
      }
      document.documentElement.setAttribute(
        "data-theme",
        system.matches ? "dark" : "light",
      );
      sync();
    };
    const storage = (e: StorageEvent) => {
      if (e.key !== "ziyatai-theme") return;
      document.documentElement.setAttribute(
        "data-theme",
        e.newValue === "dark" || e.newValue === "light"
          ? e.newValue
          : system.matches
            ? "dark"
            : "light",
      );
      sync();
    };
    sync();
    system.addEventListener("change", change);
    window.addEventListener("storage", storage);
    return () => {
      system.removeEventListener("change", change);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const label =
    locale === "ru"
      ? theme === "dark"
        ? "Включить светлую тему"
        : "Включить тёмную тему"
      : theme === "dark"
        ? "Ашық тақырыпқа ауысу"
        : "Қараңғы тақырыпқа ауысу";
  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("ziyatai-theme", next);
        } catch {
          /* The theme still works without persistence. */
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
