"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

import { fetchWithRetry } from "../../shared/network";

type AutomationRequestDto = {
  id: string;
  service: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resultFile: string | null;
  errorMessage: string | null;
};

const POLL_MS = 2500;

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "В очереди";
    case "processing":
      return "Обрабатывается";
    case "completed":
      return "Готово";
    case "failed":
      return "Ошибка";
    default:
      return status;
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "pending":
      return "border-amber-400/25 bg-amber-500/10 text-amber-100";
    case "processing":
      return "border-sky-400/25 bg-sky-500/10 text-sky-100";
    case "completed":
      return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
    case "failed":
      return "border-red-400/25 bg-red-500/10 text-red-100";
    default:
      return "border-white/10 bg-white/5 text-zinc-200";
  }
}

export function AutomationPage() {
  const [service, setService] = useState("syntx");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AutomationRequestDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchOne = useCallback(async (id: string) => {
    const res = await fetchWithRetry(`/api/requests/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error || "Не удалось загрузить заявку");
    }
    return (await res.json()) as AutomationRequestDto;
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    const id = current?.id;
    if (!id) return;
    const terminal = current.status === "completed" || current.status === "failed";
    if (terminal) {
      stopPolling();
      return;
    }
    stopPolling();
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const row = await fetchOne(id);
          setCurrent(row);
          if (row.status === "completed" || row.status === "failed") {
            stopPolling();
          }
        } catch {
          // сеть: следующий тик
        }
      })();
    }, POLL_MS);
    return () => stopPolling();
  }, [current?.id, current?.status, fetchOne, stopPolling]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    stopPolling();
    setCurrent(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, prompt }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        throw new Error(data?.error || "Не удалось создать заявку");
      }
      const row = await fetchOne(data.id);
      setCurrent(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка отправки");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2"
      >
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">Внешние нейросети</h1>
        <p className="text-sm leading-6 text-zinc-400">
          Заявка уходит в очередь, Python-воркер выполняет сценарий Playwright и прикрепляет результат. Обновление
          статуса — в реальном времени (polling).
        </p>
      </motion.section>

      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 rounded-2xl border border-white/10 bg-zinc-950/40 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Sparkles className="h-4 w-4 text-amber-200" />
          Новая заявка
        </div>

        <label className="block space-y-2 text-sm text-zinc-300">
          Сервис
          <select
            value={service}
            onChange={(ev) => setService(ev.target.value)}
            className="w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-zinc-100 outline-none focus:border-amber-400/40"
          >
            <option value="syntx">Syntx</option>
            <option value="google_flow" disabled>
              Google Flow (скоро)
            </option>
            <option value="secretvoicer" disabled>
              SecretVoicer (скоро)
            </option>
          </select>
        </label>

        <label className="block space-y-2 text-sm text-zinc-300">
          Промпт
          <textarea
            value={prompt}
            onChange={(ev) => setPrompt(ev.target.value)}
            rows={5}
            required
            placeholder="Опишите задачу для внешнего сервиса…"
            className="w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-zinc-100 outline-none focus:border-amber-400/40"
          />
        </label>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Отправить в очередь
        </button>
      </motion.form>

      {current ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3 rounded-2xl border border-white/10 bg-zinc-950/35 p-6"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-zinc-400">Заявка</span>
            <code className="rounded-lg bg-black/40 px-2 py-1 text-xs text-zinc-200">{current.id}</code>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${statusTone(current.status)}`}
            >
              {statusLabel(current.status)}
            </span>
          </div>

          <p className="text-sm text-zinc-400">
            Обновлено: {new Date(current.updatedAt).toLocaleString()} · Сервис: {current.service}
          </p>

          {current.status === "failed" && current.errorMessage ? (
            <p className="text-sm text-red-200">{current.errorMessage}</p>
          ) : null}

          {current.status === "completed" && current.resultFile ? (
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={current.resultFile}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-amber-200 underline-offset-4 hover:underline"
              >
                Открыть файл
              </a>
              <a
                href={`/api/requests/${encodeURIComponent(current.id)}/download`}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-zinc-100 hover:border-amber-400/40"
              >
                <Download className="h-4 w-4" />
                Скачать
              </a>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  );
}
