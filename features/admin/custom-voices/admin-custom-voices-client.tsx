"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";

type CustomVoiceRow = {
  voiceId: string;
  name: string;
  gender: string;
  locale: string;
  previewUrl: string;
  tagsJson: string;
  createdAt?: string;
};

export function AdminCustomVoicesClient() {
  const [items, setItems] = useState<CustomVoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [voiceId, setVoiceId] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [locale, setLocale] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [tagsLine, setTagsLine] = useState("");
  const previewFileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/custom-voices");
      const data = (await res.json().catch(() => null)) as { items?: CustomVoiceRow[]; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Не удалось загрузить список");
        setItems([]);
        return;
      }
      setItems(data?.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("voiceId", voiceId.trim());
      fd.append("name", name.trim());
      fd.append("gender", gender.trim());
      fd.append("locale", locale.trim());
      fd.append("previewUrl", previewUrl.trim());
      fd.append("tagsLine", tagsLine.trim());
      if (previewFile) {
        fd.append("previewFile", previewFile);
      }

      const res = await fetch("/api/admin/custom-voices", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Ошибка сохранения");
        return;
      }
      setVoiceId("");
      setName("");
      setGender("");
      setLocale("");
      setPreviewUrl("");
      setPreviewFile(null);
      if (previewFileInputRef.current) previewFileInputRef.current.value = "";
      setTagsLine("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/custom-voices/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Не удалось удалить");
        return;
      }
      await load();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white">Добавить голос</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          <span className="font-medium text-zinc-300">voiceId</span> — идентификатор в провайдере (как у Secret
          Voicer / ElevenLabs). Он попадёт в заявку на генерацию. Превью — по ссылке или файлом (mp3, wav, m4a и
          др.); при необходимости позже можно обновить в «Превью голосов».
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
      ) : null}

      <form
        onSubmit={submit}
        className="grid gap-4 rounded-2xl border border-[#303030] bg-[#141414] p-5 sm:grid-cols-2"
      >
        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-zinc-400">voiceId *</span>
          <input
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            required
            placeholder="например pNInz6obpgDQGcFmaJgB"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-violet-400/40"
          />
        </label>
        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-zinc-400">Название *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Как показывать в каталоге"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-zinc-400">Пол (опционально)</span>
          <input
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            placeholder="MALE / FEMALE"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-zinc-400">Locale (опционально)</span>
          <input
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            placeholder="ru-RU"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
          />
        </label>
        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-zinc-400">URL превью (опционально)</span>
          <input
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            disabled={Boolean(previewFile)}
            placeholder="https://…"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <div className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-zinc-400">Или файл превью (опционально)</span>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-white/15 bg-black/25 px-4 py-3">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <Upload className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="min-w-0 text-sm text-zinc-300">
                {previewFile ? previewFile.name : "MP3, WAV, M4A… до 25 МБ"}
              </span>
              <input
                ref={previewFileInputRef}
                id="custom-voice-preview-file"
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPreviewFile(f);
                  if (f) setPreviewUrl("");
                }}
              />
            </label>
            {previewFile ? (
              <button
                type="button"
                onClick={() => {
                  setPreviewFile(null);
                  if (previewFileInputRef.current) previewFileInputRef.current.value = "";
                }}
                className="text-xs font-medium text-red-300 hover:text-red-200"
              >
                Сбросить файл
              </button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">
            Если выбран файл, ссылка выше игнорируется. Файл загружается в Storage и сохраняется как превью голоса.
          </p>
        </div>
        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-zinc-400">Теги стиля (через запятую)</span>
          <input
            value={tagsLine}
            onChange={(e) => setTagsLine(e.target.value)}
            placeholder="narration, conversational"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/20 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Добавить голос
          </button>
        </div>
      </form>

      <div>
        <h2 className="text-xl font-semibold text-white">Свои голоса</h2>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Пока нет записей — добавьте голос формой выше.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-[#303030] bg-[#141414]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#303030] bg-[#1a1a1a] text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">voiceId</th>
                  <th className="px-4 py-3 font-medium">Название</th>
                  <th className="px-4 py-3 font-medium">Превью</th>
                  <th className="px-4 py-3 font-medium w-28" />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.voiceId} className="border-b border-[#303030] last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{row.voiceId}</td>
                    <td className="px-4 py-3 text-zinc-200">{row.name}</td>
                    <td className="px-4 py-3">
                      {row.previewUrl ? (
                        <audio controls className="h-8 max-w-[200px]" src={row.previewUrl} preload="none" />
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={deletingId !== null}
                        onClick={() => void remove(row.voiceId)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {deletingId === row.voiceId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
