"use client";

import type { ReactNode } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CirclePlus,
  CircleCheck,
  Construction,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  Shield,
  Users,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import type { ShellUser } from "../dashboard/components/dashboard-shell";
import { useBrowserNotifier } from "../shared/use-browser-notifier";

const nav = [
  { href: "/admin", label: "Главная", icon: LayoutDashboard },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/generations", label: "Генерации", icon: Shield },
  { href: "/admin/generations-ready", label: "Готовые генерации", icon: CircleCheck },
  { href: "/admin/voice-previews", label: "Превью голосов", icon: Mic },
  { href: "/admin/custom-voices", label: "Свои голоса", icon: CirclePlus },
  { href: "/admin/maintenance", label: "Техработы", icon: Construction },
];

export function AdminShell({
  children,
  user,
}: {
  children: ReactNode;
  user: ShellUser;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const { notify } = useBrowserNotifier();
  useEffect(() => {
    setMenuOpen(false);
    setNavigatingTo(null);
  }, [pathname]);

  useEffect(() => {
    let disposed = false;
    let lastNewestCreatedAt: number | null = null;

    const poll = async () => {
      try {
        const response = await fetch("/api/admin/generations?limit=1&offset=0&status=OPEN", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as
          | { items?: Array<{ createdAt?: string }> }
          | null;
        if (!response.ok || disposed) return;
        const createdAt = data?.items?.[0]?.createdAt;
        const newest = createdAt ? Date.parse(createdAt) : Number.NaN;
        if (!Number.isFinite(newest)) return;
        if (lastNewestCreatedAt !== null && newest > lastNewestCreatedAt) {
          notify();
        }
        lastNewestCreatedAt = Math.max(lastNewestCreatedAt ?? 0, newest);
      } catch {
        // Ignore transient polling/network issues.
      }
    };

    void poll();
    const id = setInterval(() => {
      void poll();
    }, 8000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [notify]);

  const handleNavClick = (href: string, e: MouseEvent<HTMLAnchorElement>) => {
    if (navigatingTo) {
      e.preventDefault();
      return;
    }
    if (href === pathname) {
      e.preventDefault();
      return;
    }
    setNavigatingTo(href);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-zinc-100">
      <div className="flex min-h-screen w-full flex-col md:flex-row">
        <aside className="hidden border-r border-[#303030] bg-[#1a1a1a]/95 backdrop-blur-xl md:sticky md:top-0 md:flex md:h-screen md:w-72 md:flex-col">
          <div className="px-4 py-6 md:px-6 md:py-8">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
              GPTML AI
            </p>
            <h1 className="mt-2 text-lg font-semibold text-white">Admin</h1>
            <p className="mt-1 truncate text-xs text-zinc-500">{user.email}</p>
          </div>

          <nav className="flex flex-1 flex-col gap-2 px-6 pb-6">
            {nav.map((item) => {
              const isActive =
                item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => handleNavClick(item.href, e)}
                  className={[
                    "group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-all duration-300",
                    isActive
                      ? "border-white/25 text-white bg-white/10"
                      : "border-white/8 bg-white/5 text-zinc-400 hover:border-white/25 hover:bg-white/10 hover:text-white",
                    navigatingTo ? "pointer-events-none opacity-80" : "",
                  ].join(" ")}
                >
                  {isActive && (
                    <motion.span
                      layoutId="admin-sidebar-active"
                      className="absolute inset-0 bg-white/10"
                      transition={{ type: "spring", stiffness: 280, damping: 26 }}
                    />
                  )}
                  <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-zinc-500 transition group-hover:text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}

            <Link
              href="/dashboard"
              onClick={(e) => handleNavClick("/dashboard", e)}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-400 transition hover:border-white/25 hover:text-white"
            >
              ← Личный кабинет
            </Link>
          </nav>

          <div className="px-4 pb-4 md:px-6 md:pb-6">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-200"
            >
              <LogOut className="h-4 w-4" />
              Выход
            </button>
          </div>
        </aside>

        <div className="border-b border-[#303030] bg-[#1a1a1a]/95 px-4 py-3 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-zinc-500">GPTML AI</p>
              <p className="truncate text-sm font-semibold text-white">Админ-панель</p>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-zinc-100 transition hover:bg-white/10"
              aria-label="Открыть меню"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
              aria-label="Закрыть меню"
            />
            <div className="absolute left-0 top-0 flex h-full w-[84%] max-w-[340px] flex-col border-r border-white/10 bg-[#161616] px-4 pb-4 pt-4 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                  <p className="truncate text-xs text-zinc-500">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-zinc-200"
                  aria-label="Закрыть меню"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {nav.map((item) => {
                  const isActive =
                    item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(e) => {
                        handleNavClick(item.href, e);
                        if (!e.defaultPrevented) setMenuOpen(false);
                      }}
                      className={[
                        "flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm font-medium transition",
                        isActive
                          ? "border-white/25 bg-white/10 text-white"
                          : "border-white/10 bg-white/5 text-zinc-300",
                      ].join(" ")}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/25">
                        <Icon className="h-4 w-4" />
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
                <Link
                  href="/dashboard"
                  onClick={(e) => {
                    handleNavClick("/dashboard", e);
                    if (!e.defaultPrevented) setMenuOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm font-medium text-zinc-300"
                >
                  ← Личный кабинет
                </Link>
              </nav>

              <button
                type="button"
                onClick={handleLogout}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200"
              >
                <LogOut className="h-4 w-4" />
                Выход
              </button>
            </div>
          </div>
        ) : null}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

