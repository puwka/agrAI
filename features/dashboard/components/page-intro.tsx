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
      className="rounded-[28px] border border-[#303030] bg-[#1a1a1a]/90 p-6 shadow-[0_20px_64px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-8"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-zinc-200">
            <Icon className="h-3.5 w-3.5" />
            {badge}
          </span>

          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
              {description}
            </p>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 text-sm text-zinc-300 sm:grid-cols-2 lg:w-auto lg:min-w-[380px] lg:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/10 bg-black/25 p-4"
            >
              <p className="text-zinc-500">{stat.label}</p>
              <p className="mt-2 break-words font-medium text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

