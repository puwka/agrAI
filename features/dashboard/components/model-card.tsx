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
          ? "border-white/25 bg-white/10 shadow-[0_0_0_1px_rgba(220,223,224,0.2),0_0_28px_rgba(220,223,224,0.12)]"
          : isDisabled
            ? "border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
            : "border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.35)] hover:border-white/25 hover:bg-white/10",
      ].join(" ")}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${model.accent} opacity-80`} />
      {isDisabled ? <div className="absolute inset-0 bg-black/35" /> : null}

      <div className="relative flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3 text-zinc-200">
            <Icon className="h-8 w-8" />
          </div>
          {isDisabled ? (
            <span className="inline-flex items-center rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs font-semibold text-zinc-200">
              {model.disabledLabel?.trim() || "В разработке"}
            </span>
          ) : isSelected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-zinc-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Выбрано
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-400">
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
                  : "border-white/15 bg-white/10 text-zinc-100 group-hover:border-white/25 group-hover:bg-white/15",
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

