"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Construction } from "lucide-react";

import { useMaintenance } from "../maintenance-context";

export function MaintenanceModal() {
  const { enabled, message } = useMaintenance();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [enabled]);

  if (!mounted || !enabled || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maintenance-title"
    >
      <div className="max-h-[min(80vh,520px)] w-full max-w-lg overflow-y-auto rounded-3xl border border-amber-400/25 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(245,158,11,0.12)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/15 text-amber-200">
            <Construction className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-3">
            <h2 id="maintenance-title" className="text-lg font-semibold text-white">
              Технические работы
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{message}</p>
            <p className="text-xs text-zinc-500">
              Создание новых заявок на генерацию сейчас недоступно. Пожалуйста, зайдите позже.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
