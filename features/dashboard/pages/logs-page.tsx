"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { motion } from "framer-motion";

import {
  formatGenerationDate,
  formatGenerationStatusLabel,
  formatPromptForLogsDisplay,
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
  resultUrl: string | null;
  resultMessage: string | null;
  createdAt: string;
};

const filters: Array<{ id: "all" | LogStatus; label: string }> = [
  { id: "all", label: "Все" },
  { id: "success", label: "Успешные" },
  { id: "queued", label: "В очереди" },
  { id: "error", label: "Ошибки" },
];

const PAGE_SIZE = 12;

export function LogsPage() {
  const [items, setItems] = useState<GenerationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [activeFilter, setActiveFilter] = useState<"all" | LogStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const load = useCallback(async () => {
    setError(null);
    setListLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        status: activeFilter,
      });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const response = await fetch(`/api/generations?${params.toString()}`);

      if (!response.ok) {
        setError("Не удалось загрузить логи");
        setItems([]);
        setTotal(0);
        return;
      }

      const data = (await response.json()) as { items?: GenerationRow[]; total?: number };
      const list = data.items ?? [];
      const t = typeof data.total === "number" ? data.total : list.length;
      setItems(list);
      setTotal(t);

      const maxPage = Math.max(0, Math.ceil(t / PAGE_SIZE) - 1);
      if (page > maxPage) {
        setPage(maxPage);
      }
    } finally {
      setListLoading(false);
    }
  }, [page, activeFilter, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const displayFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const displayTo = total === 0 ? 0 : Math.min(total, page * PAGE_SIZE + items.length);

  const pageLabel = useMemo(() => {
    if (total === 0) return "—";
    return `${page + 1} / ${totalPages}`;
  }, [page, total, totalPages]);

  return (
    <>
      <PageIntro
        badge="История запросов"
        title="Логи генераций"
        description="История ваших генераций, просмотр всех запросов и поиск по промпту."
        icon={Activity}
        stats={[
          { label: "Всего записей", value: total.toString() },
          { label: "Страница", value: pageLabel },
          {
            label: "Показано",
            value: total === 0 ? "0" : `${displayFrom}–${displayTo}`,
          },
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
                  onClick={() => {
                    setActiveFilter(filter.id);
                    setPage(0);
                  }}
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

        {listLoading ? (
          <p className="py-8 text-center text-sm text-zinc-400">Загрузка…</p>
        ) : (
          <>
            <div className="space-y-4">
              {items.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 px-6 py-12 text-center">
                  <p className="text-lg font-medium text-white">Ничего не найдено</p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Измените фильтр или поисковый запрос — или перейдите на другую страницу списка.
                  </p>
                </div>
              ) : (
                items.map((log, index) => {
                  const logStatus = mapGenerationStatusToLogStatus(log.status);
                  const canDownload =
                    log.status === "SUCCESS" &&
                    (Boolean(log.resultUrl?.trim()) || Boolean(log.resultMessage?.trim()));

                  return (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.03 }}
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

                        <div className="flex max-w-xl flex-col gap-3">
                      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm leading-6 text-zinc-300">
                        {formatPromptForLogsDisplay(log.prompt)}
                      </div>
                          {canDownload ? (
                            <a
                              href={`/api/generations/${log.id}/download`}
                              className="inline-flex items-center gap-2 self-start rounded-2xl border border-violet-400/35 bg-violet-500/15 px-4 py-2 text-xs font-semibold text-violet-200 transition hover:border-violet-400/50 hover:bg-violet-500/25"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {log.resultUrl?.trim() ? "Скачать файл" : "Скачать ответ (.txt)"}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            {total > PAGE_SIZE ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                <p className="text-sm text-zinc-400">
                  Страница {page + 1} из {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 0 || listLoading}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Назад
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1 || listLoading}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Вперёд
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </motion.section>
    </>
  );
}
