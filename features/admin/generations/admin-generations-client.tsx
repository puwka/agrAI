"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { Loader2, Send, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";

import { detectResultMediaKind } from "../../../features/dashboard/lib";

function motionVideoUrlFromPrompt(prompt: string): string | null {
  const m = /\[MotionVideo:(.+?)\]/.exec(prompt ?? "");
  const raw = m?.[1]?.trim() ?? "";
  return raw || null;
}

type AdminGeneration = {
  id: string;
  userId: string;
  modelId: string;
  modelName: string;
  prompt: string;
  aspectRatio: string;
  status: string;
  inputMode?: string;
  referenceImageUrl: string | null;
  resultUrl: string | null;
  resultMessage: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

export function AdminGenerationsClient({
  mode = "all",
}: {
  mode?: "all" | "ready";
}) {
  const router = useRouter();
  const [items, setItems] = useState<AdminGeneration[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const inFlightRef = useRef(false);
  const PAGE_SIZE = 60;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!opts?.silent) {
      setLoading(true);
    }
    if (!opts?.silent) {
      setError(null);
      setNotice(null);
    }
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const statusQuery = mode === "ready" ? "&status=SUCCESS" : "&status=OPEN";
      const response = await fetch(`/api/admin/generations?limit=${PAGE_SIZE}&offset=${offset}${statusQuery}`);
      const data = (await response.json().catch(() => null)) as
        | { items?: AdminGeneration[]; total?: number; error?: string; detail?: string }
        | null;
      if (!response.ok) {
        setError(
          data?.error || "Не удалось загрузить генерации",
        );
        return;
      }
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setItems(nextItems);
      setTotal(typeof data?.total === "number" ? data.total : 0);
    } catch {
      setError("Проблема сети при загрузке генераций. Повторите через пару секунд.");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [mode, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void load({ silent: true });
    }, 8000);
    return () => clearInterval(id);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const setUrlDraft = (id: string, value: string) => {
    setUrlDrafts((d) => ({ ...d, [id]: value }));
  };

  const setMessageDraft = (id: string, value: string) => {
    setMessageDrafts((d) => ({ ...d, [id]: value }));
  };

  const isResultUrlLike = (value: string) => {
    const v = value.trim();
    return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:");
  };

  const uploadFile = async (id: string, file: File) => {
    setError(null);
    setNotice(null);
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const response = await fetch(`/api/admin/generations/${id}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "Не удалось загрузить файл");
        return;
      }
      if (mode === "all") {
        setNotice("Файл загружен. Заявка перенесена во вкладку «Готовые генерации».");
      } else {
        setNotice("Файл успешно загружен.");
      }
      await load();
    } finally {
      setUploadingId(null);
    }
  };

  const submitUrlResult = async (id: string, directUrl?: string) => {
    const resultUrl = (directUrl ?? urlDrafts[id] ?? "").trim();
    if (!resultUrl) {
      setError("Вставьте URL или data:… результата");
      return;
    }
    setError(null);
    setNotice(null);
    setSavingId(id);
    try {
      const response = await fetch(`/api/admin/generations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultUrl, resultMessage: null }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "Не удалось сохранить");
        return;
      }
      setUrlDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      if (mode === "all") {
        setNotice("Результат отправлен. Заявка перенесена во вкладку «Готовые генерации».");
      } else {
        setNotice("Результат успешно отправлен.");
      }
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const handleQuickPaste = (id: string, e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (savingId === id || uploadingId === id || deletingId === id) return;
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      void uploadFile(id, files[0]);
      return;
    }
    const text = e.clipboardData.getData("text/plain").trim();
    if (!text) return;
    if (isResultUrlLike(text)) {
      e.preventDefault();
      void submitUrlResult(id, text);
      return;
    }
    setError("Из буфера вставки принимаются только файл, URL или data:URL результата.");
  };

  const submitTextOnly = async (id: string) => {
    const resultMessage = (messageDrafts[id] ?? "").trim();
    if (!resultMessage) {
      setError("Введите текст для клиента");
      return;
    }
    setError(null);
    setNotice(null);
    setSavingId(id);
    try {
      const response = await fetch(`/api/admin/generations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultUrl: null, resultMessage }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "Не удалось сохранить");
        return;
      }
      setMessageDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      if (mode === "all") {
        setNotice("Ответ отправлен. Заявка перенесена во вкладку «Готовые генерации».");
      } else {
        setNotice("Ответ успешно отправлен.");
      }
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const deleteGeneration = async (id: string) => {
    if (
      !window.confirm(
        "Удалить эту генерацию у пользователя? Запись исчезнет из кабинета; загруженный на сервер файл результата будет удалён.",
      )
    ) {
      return;
    }
    setError(null);
    setDeletingId(id);
    try {
      const response = await fetch(`/api/admin/generations/${id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "Не удалось удалить");
        return;
      }
      setUrlDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      setMessageDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      await load();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загрузка…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">
          {mode === "ready" ? "Готовые генерации" : "Все генерации"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {mode === "ready"
            ? "Только завершённые заявки (SUCCESS) с готовым результатом."
            : "Для заявок в ожидании: загрузите файл, вставьте URL / data:URL или отправьте текст (ошибка генерации, отказ по авторским правам и т.д.) — пользователь увидит результат в кабинете и сможет скачать файл или ответ в виде .txt."}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Страница {page} из {totalPages} · всего заявок: {total}
        </p>
      </div>

      {error && (
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
          {mode === "all" ? (
            <button
              type="button"
              onClick={() => router.push("/admin/generations-ready")}
              className="ml-2 underline underline-offset-2"
            >
              Открыть готовые
            </button>
          ) : null}
        </p>
      )}

      <div className="space-y-6">
        {items.map((g) => {
          const pending = g.status === "PENDING" || g.status === "QUEUED";
          const hasResult = Boolean(
            g.status === "SUCCESS" && (g.resultUrl || g.resultMessage),
          );
          const motionVideoUrl = g.modelId === "motion-transfer" ? motionVideoUrlFromPrompt(g.prompt) : null;

          return (
            <article
              key={g.id}
              className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-zinc-300">
                      {g.user.name}
                    </span>
                    <span className="text-zinc-500">{g.user.email}</span>
                    <span
                      className={
                        pending
                          ? "rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-amber-200"
                          : "rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-emerald-200"
                      }
                    >
                      {g.status}
                    </span>
                    <span className="text-zinc-500">{g.aspectRatio}</span>
                  </div>
                  <button
                    type="button"
                    disabled={
                      savingId === g.id || uploadingId === g.id || deletingId === g.id
                    }
                    onClick={() => void deleteGeneration(g.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {deletingId === g.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Удалить
                  </button>
                </div>
                <p className="text-sm font-medium text-white">{g.modelName}</p>
                <p className="text-sm leading-6 text-zinc-300">{g.prompt}</p>
                {g.referenceImageUrl ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                    <p className="border-b border-white/10 bg-black/50 px-3 py-2 text-xs font-medium text-fuchsia-200/90">
                      {g.modelId === "transcription"
                        ? "Исходник для транскрибации"
                        : g.modelId === "video-enhance"
                          ? "Исходник для улучшения видео"
                          : "Исходное фото пользователя"}
                    </p>
                    {detectResultMediaKind(g.referenceImageUrl) === "video" ? (
                      <video
                        src={g.referenceImageUrl}
                        controls
                        playsInline
                        preload="none"
                        className="max-h-64 w-full bg-black object-contain"
                      />
                    ) : detectResultMediaKind(g.referenceImageUrl) === "audio" ? (
                      <div className="flex max-h-64 items-center justify-center bg-black/50 px-4 py-6">
                        <audio src={g.referenceImageUrl} controls className="w-full max-w-md" preload="metadata" />
                      </div>
                    ) : (
                      <img
                        src={g.referenceImageUrl}
                        alt="Референс"
                        loading="lazy"
                        decoding="async"
                        className="max-h-48 w-full object-contain"
                      />
                    )}
                  </div>
                ) : null}
                {motionVideoUrl ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                    <p className="border-b border-white/10 bg-black/50 px-3 py-2 text-xs font-medium text-fuchsia-200/90">
                      Видео движения
                    </p>
                    <video
                      src={motionVideoUrl}
                      controls
                      playsInline
                      preload="none"
                      className="max-h-64 w-full bg-black object-contain"
                    />
                  </div>
                ) : null}
                <p className="text-xs text-zinc-500">
                  {new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(
                    new Date(g.createdAt),
                  )}
                </p>

                {pending && (
                  <div className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-amber-200/90">
                        Файл с компьютера
                      </p>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm text-amber-100 transition hover:border-amber-400/40 hover:bg-black/50">
                        <Upload className="h-4 w-4" />
                        <span>Выбрать и загрузить</span>
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,audio/mpeg,audio/wav,.mp4,.webm,.mp3,.wav"
                          disabled={uploadingId === g.id || savingId === g.id}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void uploadFile(g.id, file);
                          }}
                        />
                      </label>
                      {uploadingId === g.id ? (
                        <p className="flex items-center gap-2 text-xs text-amber-200/80">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Загрузка…
                        </p>
                      ) : null}
                    </div>
                    <div className="border-t border-white/10 space-y-3 pt-3">
                      <div className="space-y-2">
                        <label className="block text-xs font-medium uppercase tracking-wide text-amber-200/90">
                          Быстрая вставка результата (Ctrl+V)
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Вставьте файл, URL или data:URL — отправится сразу"
                          onPaste={(e) => handleQuickPaste(g.id, e)}
                          onChange={(e) => {
                            if (e.currentTarget.value) e.currentTarget.value = "";
                          }}
                          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400/40"
                        />
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          Вставка файла запускает загрузку, вставка ссылки отправляет результат пользователю.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium uppercase tracking-wide text-amber-200/90">
                          Или URL / data для пользователя
                        </label>
                        <textarea
                          value={urlDrafts[g.id] ?? ""}
                          onChange={(e) => setUrlDraft(g.id, e.target.value)}
                          rows={3}
                          placeholder="https://… или data:image/png;base64,…"
                          className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400/40"
                        />
                        <button
                          type="button"
                          disabled={savingId === g.id || uploadingId === g.id}
                          onClick={() => void submitUrlResult(g.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-amber-400/35 bg-amber-500/20 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50"
                        >
                          {savingId === g.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Отправить по ссылке
                        </button>
                      </div>
                      <div className="space-y-2 border-t border-white/10 pt-3">
                        <label className="block text-xs font-medium uppercase tracking-wide text-amber-200/90">
                          Текст вместо файла
                        </label>
                        <textarea
                          value={messageDrafts[g.id] ?? ""}
                          onChange={(e) => setMessageDraft(g.id, e.target.value)}
                          rows={4}
                          placeholder="Например: не удалось сгенерировать; запрос нарушает авторские права…"
                          className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400/40"
                        />
                        <button
                          type="button"
                          disabled={savingId === g.id || uploadingId === g.id}
                          onClick={() => void submitTextOnly(g.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-zinc-500/40 bg-zinc-600/30 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-600/45 disabled:opacity-50"
                        >
                          {savingId === g.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Отправить только текст
                        </button>
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          Текущая ссылка на файл будет снята. Чтобы отдать файл — загрузите его кнопкой
                          выше или отправьте по ссылке.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
                {hasResult && g.resultUrl ? (
                  detectResultMediaKind(g.resultUrl) === "video" ? (
                    <video
                      src={`/api/generations/${g.id}/download?inline=1`}
                      controls
                      playsInline
                      preload="none"
                      className="h-full w-full max-h-72 bg-black object-contain"
                    />
                  ) : detectResultMediaKind(g.resultUrl) === "audio" ? (
                    <div className="flex min-h-[200px] items-center justify-center bg-black/50 px-4 py-6">
                      <audio
                        src={`/api/generations/${g.id}/download?inline=1`}
                        controls
                        className="w-full max-w-md"
                        preload="metadata"
                      />
                    </div>
                  ) : (
                    <img
                      src={`/api/generations/${g.id}/download?inline=1`}
                      alt={`Результат ${g.id}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full max-h-72 object-contain"
                    />
                  )
                ) : hasResult && g.resultMessage ? (
                  <div className="max-h-72 overflow-y-auto p-4 text-left text-sm leading-relaxed text-zinc-200">
                    {g.resultMessage}
                  </div>
                ) : (
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-zinc-500">
                    <p>Нет превью</p>
                    {pending && <p className="text-xs text-zinc-600">Ожидает загрузки результата</p>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading || page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          Назад
        </button>
        <button
          type="button"
          disabled={loading || page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
