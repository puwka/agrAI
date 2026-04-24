"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { MaintenanceProvider } from "../maintenance-context";
import { MaintenanceModal } from "./maintenance-modal";
import { Sidebar } from "./sidebar";
import { getActiveNavItem } from "../lib";
import { useBrowserNotifier } from "../../shared/use-browser-notifier";

export type ShellUser = {
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  /** Краткий текст о подписке; для админа обычно не передаётся */
  subscriptionSummary?: string | null;
};

export function DashboardShell({
  children,
  user,
  dashboardBanner,
}: {
  children: ReactNode;
  user: ShellUser;
  dashboardBanner?: { enabled: boolean; message: string };
}) {
  const pathname = usePathname();
  const activeItem = getActiveNavItem(pathname);
  const { notify } = useBrowserNotifier();
  const knownStatusesRef = useRef<Map<string, string>>(new Map());
  const initializedRef = useRef(false);

  const isAdmin = user.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) return;
    let disposed = false;
    const tokenOf = (status: string, hasResult: boolean) => `${status}:${hasResult ? "1" : "0"}`;

    const poll = async () => {
      try {
        const response = await fetch("/api/generations?limit=10&offset=0&brief=1", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as
          | { items?: Array<{ id: string; status: string; resultUrl?: string | null; resultMessage?: string | null }> }
          | null;
        if (!response.ok || disposed) return;
        const items = Array.isArray(data?.items) ? data.items : [];

        const next = new Map<string, string>();
        let shouldNotify = false;
        for (const item of items) {
          const hasResult = Boolean(item.resultUrl || item.resultMessage);
          const nowToken = tokenOf(item.status, hasResult);
          const prevToken = knownStatusesRef.current.get(item.id);
          if (initializedRef.current) {
            const nowReady = item.status === "SUCCESS" && hasResult;
            const prevReady = prevToken ? prevToken.startsWith("SUCCESS:1") : false;
            if (nowReady && !prevReady) {
              shouldNotify = true;
            }
          }
          next.set(item.id, nowToken);
        }

        knownStatusesRef.current = next;
        if (!initializedRef.current) {
          initializedRef.current = true;
          return;
        }
        if (shouldNotify) {
          notify();
        }
      } catch {
        // Ignore transient polling/network issues.
      }
    };

    void poll();
    const id = setInterval(() => {
      void poll();
    }, 12000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [isAdmin, notify]);

  return (
    <MaintenanceProvider isAdmin={isAdmin}>
      <div className="min-h-screen bg-[#0f0f0f] text-zinc-100">
        <MaintenanceModal />
        <div className="flex min-h-screen w-full flex-col md:flex-row">
          <Sidebar user={user} />

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="space-y-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#303030] bg-[#1a1a1a]/85 px-4 py-3 backdrop-blur-xl">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Текущий раздел</p>
                  <p className="mt-1 text-sm font-medium text-white">{activeItem.label}</p>
                </div>
                <p className="max-w-xl text-sm text-zinc-400">{activeItem.description}</p>
              </div>
              {dashboardBanner?.enabled && dashboardBanner.message ? (
                <div className="rounded-2xl border border-violet-400/35 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
                  {dashboardBanner.message}
                </div>
              ) : null}

              {children}
            </motion.div>
          </main>
        </div>
      </div>
    </MaintenanceProvider>
  );
}
