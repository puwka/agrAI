"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { MaintenanceProvider } from "../maintenance-context";
import { MaintenanceModal } from "./maintenance-modal";
import { Sidebar } from "./sidebar";
import { getActiveNavItem } from "../lib";

export type ShellUser = {
  name: string;
  email: string;
  role: "ADMIN" | "USER";
};

export function DashboardShell({
  children,
  user,
}: {
  children: ReactNode;
  user: ShellUser;
}) {
  const pathname = usePathname();
  const activeItem = getActiveNavItem(pathname);

  const isAdmin = user.role === "ADMIN";

  return (
    <MaintenanceProvider isAdmin={isAdmin}>
      <div className="min-h-screen bg-[#0f0f0f] text-zinc-100">
        <MaintenanceModal />
        <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col md:flex-row">
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
                  <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                    Current Section
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">{activeItem.label}</p>
                </div>
                <p className="max-w-xl text-sm text-zinc-400">{activeItem.description}</p>
              </div>

              {children}
            </motion.div>
          </main>
        </div>
      </div>
    </MaintenanceProvider>
  );
}
