"use client";

import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

import type { Model } from "../types";

type ModelCardProps = {
  model: Model;
  isSelected: boolean;
  onSelect: () => void;
};

export function ModelCard({ model, isSelected, onSelect }: ModelCardProps) {
  const Icon = model.icon;
  const isDisabled = Boolean(model.disabled);

  return (
    <motion.button
      type="button"
      disabled={isDisabled}
      whileHover={isDisabled ? undefined : { y: -4 }}
      whileTap={isDisabled ? undefined : { scale: 0.99 }}
      onClick={isDisabled ? undefined : onSelect}
      className={[
        "group relative w-full flex-1 h-full min-h-[210px] overflow-hidden rounded-3xl border p-5 text-left transition-all duration-300",
        "bg-gradient-to-br from-white/8 to-white/4 backdrop-blur-xl",
        isDisabled ? "cursor-not-allowed opacity-70" : "",
        isSelected
          ? "border-violet-400/70 shadow-[0_0_0_1px_rgba(192,132,252,0.3),0_0_36px_rgba(124,58,237,0.28)]"
          : isDisabled
            ? "border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
            : "border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.35)] hover:border-violet-400/30 hover:shadow-[0_0_32px_rgba(124,58,237,0.18)]",
      ].join(" ")}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${model.accent} opacity-80`} />
      {isDisabled ? <div className="absolute inset-0 bg-black/35" /> : null}

      <div className="relative flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3 text-violet-200">
            <Icon className="h-8 w-8" />
          </div>
          {isDisabled ? (
            <span className="inline-flex items-center rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs font-semibold text-zinc-200">
              {model.disabledLabel?.trim() || "В разработке"}
            </span>
          ) : isSelected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Выбрано
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-200/80">
              {model.category}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">{model.name}</h3>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-300">{model.description}</p>
          </div>

          <div className="pt-2">
            <span
              className={[
                "inline-flex rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-300",
                isDisabled
                  ? "border-white/10 bg-black/25 text-zinc-200"
                  : "border-violet-400/20 bg-violet-500/10 text-violet-100 group-hover:border-violet-300/35 group-hover:bg-violet-500/20",
              ].join(" ")}
            >
              {isDisabled ? "Недоступно" : "Попробовать"}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}
