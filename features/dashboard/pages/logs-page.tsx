"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Search } from "lucide-react";
import { motion } from "framer-motion";

import {
  formatGenerationDate,
  formatGenerationStatusLabel,
  getStatusTone,
  mapGenerationStatusToLogStatus,
} from "../lib";
import { PageIntro } from "../components/page-intro";
import type { LogStatus } from "../types";

type GenerationRow = {
  id: string;
  modelName: string;
  prompt: string;
  status: string;
  createdAt: string;
};

const filters: Array<{ id: "all" | LogStatus; label: string }> = [
  { id: "all", label: "Все" },
  { id: "success", label: "Успешные" },
  { id: "queued", label: "В очереди" },
  { id: "error", label: "Ошибки" },
];

export function LogsPage() {
  const [items, setItems] = useState<GenerationRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | LogStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/generations");

    if (!response.ok) {
      setError("Не удалось загрузить логи");
      return;
    }

    const data = (await response.json()) as GenerationRow[];
    setItems(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredLogs = useMemo(() => {
    return items.filter((log) => {
      const logStatus = mapGenerationStatusToLogStatus(log.status);
      const matchesFilter = activeFilter === "all" ? true : logStatus === activeFilter;
      const matchesSearch =
        searchQuery.trim() === ""
          ? true
          : `${log.modelName} ${log.prompt}`.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesFilter && matchesSearch;
    });
  }, [items, activeFilter, searchQuery]);

  return (
    <>
      <PageIntro
        badge="Execution History"
        title="Логи генераций"
        description="История ваших генераций из базы данных."
        icon={Activity}
        stats={[
          { label: "Всего событий", value: items.length.toString() },
          { label: "Фильтр", value: activeFilter === "all" ? "Все" : activeFilter },
          { label: "Результатов", value: filteredLogs.length.toString() },
        ]}
      />

      {error && (
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl"
      >
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => {
              const isActive = activeFilter === filter.id;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setActiveFilter(filter.id)}
                  className={[
                    "rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all duration-300",
                    isActive
                      ? "border-violet-400/40 bg-violet-500/15 text-white shadow-[0_0_24px_rgba(124,58,237,0.16)]"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:border-violet-400/20 hover:text-white",
                  ].join(" ")}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <label className="relative block w-full max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по промпту или модели"
              className="w-full rounded-2xl border border-white/10 bg-black/25 py-3 pl-11 pr-4 text-sm text-white outline-none transition-all duration-300 placeholder:text-zinc-500 focus:border-violet-400/40 focus:shadow-[0_0_24px_rgba(124,58,237,0.12)]"
            />
          </label>
        </div>

        <div className="space-y-4">
          {filteredLogs.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 px-6 py-12 text-center">
              <p className="text-lg font-medium text-white">Ничего не найдено</p>
              <p className="mt-2 text-sm text-zinc-400">
                Измените фильтр или поисковый запрос, чтобы увидеть события.
              </p>
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const logStatus = mapGenerationStatusToLogStatus(log.status);

              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: index * 0.04 }}
                  className="rounded-3xl border border-white/10 bg-black/20 p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">Генерация</h3>
                        <span
                          className={[
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            getStatusTone(logStatus),
                          ].join(" ")}
                        >
                          {logStatus === "success"
                            ? "Готово"
                            : logStatus === "queued"
                              ? "Ожидание"
                              : "Ошибка"}
                        </span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                            Модель
                          </p>
                          <p className="mt-2 text-sm text-zinc-300">{log.modelName}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                            Создано
                          </p>
                          <p className="mt-2 text-sm text-zinc-300">
                            {formatGenerationDate(log.createdAt)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                            Статус
                          </p>
                          <p className="mt-2 text-sm text-zinc-300">
                            {formatGenerationStatusLabel(log.status)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="max-w-xl rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm leading-6 text-zinc-300">
                      {log.prompt}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </motion.section>
    </>
  );
}
