"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Construction, LayoutDashboard, LogOut, Shield, Users } from "lucide-react";
import { motion } from "framer-motion";
import { signOut } from "next-auth/react";

import type { ShellUser } from "../dashboard/components/dashboard-shell";

const nav = [
  { href: "/admin", label: "Обзор", icon: LayoutDashboard },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/generations", label: "Генерации", icon: Shield },
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

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col md:flex-row">
        <aside className="border-b border-white/10 bg-black/40 backdrop-blur-xl md:sticky md:top-0 md:flex md:h-screen md:w-72 md:flex-col md:border-r md:border-b-0">
          <div className="px-4 py-6 md:px-6 md:py-8">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
              agrAI
            </p>
            <h1 className="mt-2 text-lg font-semibold text-white">Admin</h1>
            <p className="mt-1 truncate text-xs text-zinc-500">{user.email}</p>
          </div>

          <nav className="flex gap-2 overflow-x-auto px-4 pb-4 md:flex-1 md:flex-col md:px-6 md:pb-6">
            {nav.map((item) => {
              const isActive =
                item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
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
                      layoutId="admin-sidebar-active"
                      className="absolute inset-0 bg-violet-500/15"
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
              className="flex min-w-fit items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-400 transition hover:border-violet-400/20 hover:text-white"
            >
              ← Личный кабинет
            </Link>
          </nav>

          <div className="px-4 pb-4 md:px-6 md:pb-6">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-200"
            >
              <LogOut className="h-4 w-4" />
              Выход
            </button>
          </div>
        </aside>

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
