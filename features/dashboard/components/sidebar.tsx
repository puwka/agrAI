"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, PanelLeftClose, Shield } from "lucide-react";
import { motion } from "framer-motion";
import { signOut } from "next-auth/react";

import { navItems } from "../config";
import type { ShellUser } from "./dashboard-shell";

export function Sidebar({ user }: { user: ShellUser }) {
  const pathname = usePathname();

  return (
    <aside className="border-b border-white/10 bg-black/40 backdrop-blur-xl md:sticky md:top-0 md:flex md:h-screen md:w-72 md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-3 px-4 py-5 md:px-6 md:py-7">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/10 text-violet-200 shadow-[0_0_30px_rgba(124,58,237,0.25)]">
            <PanelLeftClose className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
              agrAI
            </p>
            <h1 className="truncate text-lg font-semibold text-white">User Dashboard</h1>
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
          </div>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto px-4 pb-4 md:flex-1 md:flex-col md:px-6 md:pb-6">
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
                "group relative flex min-w-fit items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-all duration-300",
                isActive
                  ? "border-violet-400/40 text-white shadow-[0_0_30px_rgba(124,58,237,0.18)]"
                  : "border-white/8 bg-white/5 text-zinc-400 hover:border-violet-400/20 hover:bg-white/8 hover:text-white",
              ].join(" ")}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-bg"
                  className="absolute inset-0 bg-violet-500/15"
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                />
              )}
              <span
                className={[
                  "relative z-10 flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-300",
                  isActive
                    ? "border-violet-400/30 bg-violet-500/15 text-violet-200"
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
              "group relative flex min-w-fit items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-all duration-300",
              pathname.startsWith("/admin")
                ? "border-violet-400/40 text-white shadow-[0_0_30px_rgba(124,58,237,0.18)]"
                : "border-white/8 bg-white/5 text-zinc-400 hover:border-violet-400/20 hover:bg-white/8 hover:text-white",
            ].join(" ")}
          >
            {pathname.startsWith("/admin") && (
                <motion.span
                  layoutId="sidebar-active-bg"
                  className="absolute inset-0 bg-violet-500/15"
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

      <div className="space-y-3 px-4 pb-4 md:px-6 md:pb-6">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-400">
          <p className="font-medium text-zinc-300">{user.name}</p>
          <p className="mt-1">Роль: {user.role === "ADMIN" ? "Администратор" : "Пользователь"}</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-300 transition-all duration-300 hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-200"
        >
          <LogOut className="h-4 w-4" />
          Выход
        </button>
      </div>
    </aside>
  );
}
