"use client";

import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Mic, Play, X } from "lucide-react";

export type VoiceOption = {
  id: string;
  name: string;
  gender: string;
  locale: string;
  preview_audio_url: string;
  voice_style_tags: string[];
  usage_count: number;
};

function initialLetter(name: string) {
  const t = name.trim();
  if (!t) return "?";
  const ch = t[0];
  return ch.toUpperCase();
}

function formatTagsLine(tags: string[]) {
  if (!tags.length) return "Без описания стиля";
  return tags
    .slice(0, 4)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(", ");
}

function categoryLabel(v: VoiceOption) {
  const tags = (v.voice_style_tags ?? []).map((t) => t.trim()).filter(Boolean);
  const t0 = tags[0]?.toLowerCase() ?? "";
  const known = new Set([
    "narration",
    "characters",
    "conversational",
    "news",
    "audiobook",
    "meditation",
    "social media",
  ]);
  if (t0 && known.has(t0)) {
    return tags[0].charAt(0).toUpperCase() + tags[0].slice(1).toLowerCase();
  }
  const gen =
    v.gender.toUpperCase() === "MALE"
      ? "Мужской"
      : v.gender.toUpperCase() === "FEMALE"
        ? "Женский"
        : "Голос";
  if (tags.length) {
    return `${gen} • ${formatTagsLine(tags)}`;
  }
  return gen;
}

function extractDirectPreviewUrl(url: string): string | null {
  const raw = (url ?? "").trim();
  if (!raw.startsWith("/api/voice-preview?")) return null;
  try {
    const probe = new URL(raw, "http://localhost");
    const u = (probe.searchParams.get("u") ?? "").trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) return null;
    return u;
  } catch {
    return null;
  }
}

export function VoicePickerModal({
  open,
  value,
  onClose,
  onConfirm,
}: {
  open: boolean;
  value: VoiceOption | null;
  onClose: () => void;
  onConfirm: (voice: VoiceOption) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [totalCatalogCount, setTotalCatalogCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(value?.id ?? null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/secret-voicer/voices");
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Не удалось загрузить голоса");
      }
      const data = (await response.json()) as {
        voices: VoiceOption[];
        total_count?: number;
      };
      const list = data.voices ?? [];
      setVoices(list);
      setTotalCatalogCount(typeof data.total_count === "number" ? data.total_count : list.length);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Ошибка загрузки");
      setVoices([]);
      setTotalCatalogCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadVoices();
  }, [open, loadVoices]);

  useEffect(() => {
    if (open) {
      setSelectedId(value?.id ?? null);
    }
  }, [open, value?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      setPlayingId(null);
    }
  }, [open]);

  const sortedVoices = useMemo(() => {
    return [...voices].sort((a, b) => {
      if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
      return a.name.localeCompare(b.name, "ru");
    });
  }, [voices]);

  const stopPreview = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    setPlayingId(null);
  };

  const playPreview = (voice: VoiceOption, e?: MouseEvent) => {
    e?.stopPropagation();
    if (!voice.preview_audio_url) return;

    if (playingId === voice.id) {
      stopPreview();
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const a = audioRef.current;
    a.onended = () => setPlayingId(null);
    a.onerror = () => {
      const direct = extractDirectPreviewUrl(voice.preview_audio_url);
      if (direct && a.src !== direct) {
        // Фолбэк: часть preview из proxy может не стартовать, пробуем прямой URL.
        a.src = direct;
        void a.play().catch(() => {
          setPlayingId(null);
        });
        return;
      }
      setPlayingId(null);
    };

    stopPreview();
    setPlayingId(voice.id);
    a.src = voice.preview_audio_url;
    a.load();
    void a.play().catch(() => {
      const direct = extractDirectPreviewUrl(voice.preview_audio_url);
      if (direct && a.src !== direct) {
        a.src = direct;
        a.load();
        void a.play().catch(() => {
          setPlayingId(null);
        });
        return;
      }
      setPlayingId(null);
    });
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-3 py-6 sm:px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Закрыть"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-picker-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative z-10 flex max-h-[min(400px,calc(100vh-72px))] w-[min(440px,calc(100vw-20px))] flex-col overflow-hidden rounded-2xl border border-[#303030] bg-[#1a1a1a] text-zinc-100 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#303030] bg-[#141414] px-4 py-2.5">
              <div className="min-w-0">
                <p
                  id="voice-picker-title"
                  className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500"
                >
                  Каталог голосов
                </p>
                <p className="truncate text-sm font-semibold text-white">
                  Выберите голос
                  {totalCatalogCount > 0 ? (
                    <span className="ml-1.5 font-normal text-zinc-500">({totalCatalogCount})</span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:border-white/15 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[#121212]">
              {loading ? (
                <p className="px-4 py-6 text-center text-sm text-zinc-500">Загрузка…</p>
              ) : loadError ? (
                <p className="px-4 py-6 text-center text-sm text-red-300">{loadError}</p>
              ) : (
                <ul className="py-1">
                  {sortedVoices.map((v) => {
                    const selected = selectedId === v.id;
                    const tagsLine = formatTagsLine(v.voice_style_tags ?? []);
                    const primary = `${v.name} — ${tagsLine}`;

                    return (
                      <li key={v.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(v.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(v.id);
                            }
                          }}
                          className={[
                            "flex cursor-pointer items-center gap-3 px-3 py-2 outline-none transition-colors",
                            selected ? "bg-white/10" : "hover:bg-white/5",
                          ].join(" ")}
                        >
                          <div
                            className={[
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                              selected
                                ? "border-white/25 bg-white/15 text-white"
                                : "border-white/10 bg-zinc-800/80 text-zinc-400",
                            ].join(" ")}
                          >
                            {initialLetter(v.name)}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-1.5">
                              <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-zinc-100">
                                <span className="line-clamp-2">{primary}</span>
                              </p>
                              {selected ? (
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-200" strokeWidth={2.5} />
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-zinc-500">{categoryLabel(v)}</p>
                          </div>

                          <button
                            type="button"
                            disabled={!v.preview_audio_url}
                            onClick={(e) => playPreview(v, e)}
                            className={[
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition",
                              playingId === v.id
                                ? "border-white/30 bg-white/15 text-white"
                                : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white",
                              !v.preview_audio_url ? "cursor-not-allowed opacity-40" : "",
                            ].join(" ")}
                            aria-label={playingId === v.id ? "Остановить" : "Прослушать"}
                          >
                            <Play className="ml-0.5 h-3.5 w-3.5 fill-current text-zinc-100" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#303030] bg-[#141414] px-3 py-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-white/15 hover:bg-white/10 hover:text-white"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!selectedId}
                onClick={() => {
                  const picked = voices.find((voice) => voice.id === selectedId);
                  if (!picked) return;
                  onConfirm(picked);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-[#27272a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Mic className="h-3.5 w-3.5 opacity-90" />
                Выбрать
              </button>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
