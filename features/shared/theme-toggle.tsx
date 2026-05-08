"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme-preference";

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function detectInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const current = document.documentElement.getAttribute("data-theme");
  if (current === "light" || current === "dark") return current;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = detectInitialTheme();
    setTheme(initial);
    applyTheme(initial);
    setReady(true);
  }, []);

  const toggle = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!ready}
      className={[
        "theme-toggle-btn inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/55 text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:scale-[1.03] hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ].join(" ")}
      aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
      title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
