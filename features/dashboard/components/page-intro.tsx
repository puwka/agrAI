"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

type IntroStat = {
  label: string;
  value: string;
};

type PageIntroProps = {
  badge: string;
  title: string;
  description: string;
  icon: LucideIcon;
  stats: IntroStat[];
};

export function PageIntro({
  badge,
  title,
  description,
  icon: Icon,
  stats,
}: PageIntroProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-violet-200">
            <Icon className="h-3.5 w-3.5" />
            {badge}
          </span>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
              {description}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm text-zinc-300 sm:min-w-[380px] sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/10 bg-black/25 p-4"
            >
              <p className="text-zinc-500">{stat.label}</p>
              <p className="mt-2 font-medium text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
