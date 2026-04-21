"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, PanelLeftClose, Shield, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { navItems } from "../config";
import type { ShellUser } from "./dashboard-shell";

export function Sidebar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      <aside className="hidden border-r border-[#303030] bg-[#1a1a1a]/95 backdrop-blur-xl md:sticky md:top-0 md:flex md:h-screen md:w-72 md:flex-col">
        <div className="flex items-center gap-3 px-6 py-7">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white shadow-[0_0_24px_rgba(220,223,224,0.16)]">
            <PanelLeftClose className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">GPTML AI</p>
            <h1 className="truncate text-lg font-semibold text-white">Панель</h1>
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-2 px-6 pb-6">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-all duration-300",
                isActive
                  ? "border-white/25 text-white bg-white/10"
                  : "border-white/8 bg-white/5 text-zinc-400 hover:border-white/25 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-bg"
                  className="absolute inset-0 bg-white/10"
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                />
              )}
              <span
                className={[
                  "relative z-10 flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-300",
                  isActive
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-white/10 bg-black/20 text-zinc-500 group-hover:text-white",
                ].join(" ")}
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}

        {user.role === "ADMIN" && (
          <Link
            href="/admin"
            className={[
              "group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-all duration-300",
              pathname.startsWith("/admin")
                ? "border-white/25 text-white bg-white/10"
                : "border-white/8 bg-white/5 text-zinc-400 hover:border-white/25 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            {pathname.startsWith("/admin") && (
                <motion.span
                  layoutId="sidebar-active-bg"
                  className="absolute inset-0 bg-white/10"
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                />
              )}
            <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-zinc-500 transition-all duration-300 group-hover:text-white">
              <Shield className="h-4.5 w-4.5" />
            </span>
            <span className="relative z-10">Админка</span>
          </Link>
        )}
        </nav>

      <div className="space-y-3 px-6 pb-6">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-400">
          <p className="font-medium text-zinc-300">{user.name}</p>
          {user.role !== "ADMIN" && user.subscriptionSummary ? (
            <p className="mt-2 border-t border-white/10 pt-2 leading-relaxed text-zinc-300">
              {user.subscriptionSummary}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-300 transition-all duration-300 hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-200"
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
            <p className="truncate text-sm font-semibold text-white">Личный кабинет</p>
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
              {navItems.map((item) => {
                const isActive =
                  item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
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
              {user.role === "ADMIN" ? (
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className={[
                    "flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm font-medium transition",
                    pathname.startsWith("/admin")
                      ? "border-white/25 bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-zinc-300",
                  ].join(" ")}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/25">
                    <Shield className="h-4 w-4" />
                  </span>
                  Админка
                </Link>
              ) : null}
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
    </>
  );
}

