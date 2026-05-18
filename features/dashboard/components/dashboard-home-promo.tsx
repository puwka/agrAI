"use client";

import { motion } from "framer-motion";

import { useMaintenance } from "../maintenance-context";

type DashboardHomePromoProps = {
  enabled: boolean;
  html: string;
};

export function DashboardHomePromo({ enabled, html }: DashboardHomePromoProps) {
  const { enabled: maintenanceOn } = useMaintenance();

  if (!enabled || !html.trim() || maintenanceOn) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut", delay: 0.04 }}
      className="dashboard-home-promo overflow-hidden rounded-[28px] border border-white/10 bg-[#1a1a1a]/90"
    >
      <motion.div
        className="px-4 py-4 sm:px-6 sm:py-5 [&_a]:text-violet-300 [&_a:hover]:text-violet-200 [&_img]:max-w-full [&_img]:h-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </motion.div>
  );
}
