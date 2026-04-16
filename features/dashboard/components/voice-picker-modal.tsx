"use client";

import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, Heart, Mic, Play, Search, Sparkles, Users, X } from "lucide-react";

export type VoiceOption = {
  id: string;
  name: string;
  gender: string;
  locale: string;
  preview_audio_url: string;
  voice_style_tags: string[];
  usage_count: number;
};

const FAVORITES_KEY = "secretVoicerFavoriteVoiceIds";

function readFavoriteIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.map((v) => String(v)));
  } catch {
    return new Set<string>();
  }
}

function writeFavoriteIds(ids: Set<string>) {
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
}

function languageBucket(locale: string): "en" | "ru" | "multi" {
  const lc = locale.toLowerCase();
  if (lc.startsWith("ru")) return "ru";
  if (lc.startsWith("en")) return "en";
  return "multi";
}

function isPopularVoice(v: VoiceOption) {
  return v.usage_count >= 20_000;
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

  const [query, setQuery] = useState("");
  const [genderMale, setGenderMale] = useState(true);
  const [genderFemale, setGenderFemale] = useState(true);
  const [langEn, setLangEn] = useState(true);
  const [langRu, setLangRu] = useState(true);
  const [langMulti, setLangMulti] = useState(true);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyPopular, setOnlyPopular] = useState(false);
  const [sort, setSort] = useState<"popularity" | "name">("popularity");
  const [selectedId, setSelectedId] = useState<string | null>(value?.id ?? null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => readFavoriteIds());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

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

  const tagFrequency = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of voices) {
      for (const t of v.voice_style_tags) {
        const key = t.toLowerCase();
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [voices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = voices.filter((v) => {
      if (!v.id) return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;

      const g = v.gender.toUpperCase();
      const genderOk = (genderMale && g === "MALE") || (genderFemale && g === "FEMALE");
      if (!genderOk) return false;

      const bucket = languageBucket(v.locale);
      const langOk =
        (langEn && bucket === "en") || (langRu && bucket === "ru") || (langMulti && bucket === "multi");
      if (!langOk) return false;

      if (onlyFavorites && !favoriteIds.has(v.id)) return false;
      if (onlyPopular && !isPopularVoice(v)) return false;

      if (selectedTag) {
        const tags = v.voice_style_tags.map((t) => t.toLowerCase());
        if (!tags.includes(selectedTag)) return false;
      }

      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ru");
      if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
      return a.name.localeCompare(b.name, "ru");
    });

    return list;
  }, [
    favoriteIds,
    genderFemale,
    genderMale,
    langEn,
    langMulti,
    langRu,
    onlyFavorites,
    onlyPopular,
    query,
    selectedTag,
    sort,
    voices,
  ]);

  const stopPreview = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    setPlayingId(null);
  };

  const playPreview = (voice: VoiceOption) => {
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
    a.onerror = () => setPlayingId(null);

    stopPreview();
    setPlayingId(voice.id);
    a.src = voice.preview_audio_url;
    void a.play().catch(() => {
      setPlayingId(null);
    });
  };

  const toggleFavorite = (voiceId: string, event: MouseEvent) => {
    event.stopPropagation();
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(voiceId)) next.delete(voiceId);
      else next.add(voiceId);
      writeFavoriteIds(next);
      return next;
    });
  };

  const accentPill = (locale: string) => {
    const lc = locale.toLowerCase();
    if (lc.startsWith("ru")) return { label: "RU", className: "border-sky-400/25 bg-sky-500/10 text-sky-100" };
    if (lc.includes("gb")) return { label: "GB", className: "border-white/15 bg-white/5 text-zinc-200" };
    if (lc.startsWith("en")) return { label: "EN", className: "border-red-400/25 bg-red-500/10 text-red-100" };
    return { label: "INTL", className: "border-violet-400/25 bg-violet-500/10 text-violet-100" };
  };

  const popularityDots = (v: VoiceOption) => {
    if (v.usage_count >= 80_000) return 3;
    if (v.usage_count >= 8_000) return 2;
    return 1;
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-3 py-6 sm:px-6"
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
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative z-10 flex h-[min(820px,calc(100vh-48px))] w-[min(1120px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#141416] shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
          >
            <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-2 text-amber-200">
                  <Mic className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Выбор голоса</p>
                  <p className="text-xs text-zinc-500">
                    Голоса с превью: <span className="font-semibold text-zinc-300">{totalCatalogCount}</span>{" "}
                    (публичный витринный API Secret Voicer + пресеты ElevenLabs с официальными образцами). Число{" "}
                    <span className="whitespace-nowrap">«106»</span> у Secret Voicer — размер полного каталога у
                    них; без их внутреннего API витрина отдаёт только часть, поэтому список дополнен совместимыми
                    пресетами.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex min-h-0 flex-1">
              <aside className="hidden w-[280px] shrink-0 flex-col border-r border-white/10 bg-black/20 md:flex">
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Поиск</p>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Поиск по имени..."
                        className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400/35"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Пол</p>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input
                        type="checkbox"
                        checked={genderMale}
                        onChange={() => setGenderMale((v) => !v)}
                        className="accent-amber-400"
                      />
                      <Users className="h-4 w-4 text-amber-300/90" />
                      Мужской
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input
                        type="checkbox"
                        checked={genderFemale}
                        onChange={() => setGenderFemale((v) => !v)}
                        className="accent-amber-400"
                      />
                      <Users className="h-4 w-4 text-amber-200/90" />
                      Женский
                    </label>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Язык</p>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input type="checkbox" checked={langEn} onChange={() => setLangEn((v) => !v)} className="accent-amber-400" />
                      Английский (EN)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input type="checkbox" checked={langRu} onChange={() => setLangRu((v) => !v)} className="accent-amber-400" />
                      Русский (RU)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input type="checkbox" checked={langMulti} onChange={() => setLangMulti((v) => !v)} className="accent-amber-400" />
                      Прочие / мультиязычные
                    </label>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Быстрые</p>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input
                        type="radio"
                        name="voiceQuick"
                        checked={onlyFavorites}
                        onChange={() => {
                          setOnlyFavorites(true);
                          setOnlyPopular(false);
                        }}
                        className="accent-amber-400"
                      />
                      <Heart className="h-4 w-4 text-amber-300/90" />
                      Только избранные
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input
                        type="radio"
                        name="voiceQuick"
                        checked={onlyPopular}
                        onChange={() => {
                          setOnlyPopular(true);
                          setOnlyFavorites(false);
                        }}
                        className="accent-amber-400"
                      />
                      <Flame className="h-4 w-4 text-amber-300/90" />
                      Только популярные
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                      <input
                        type="radio"
                        name="voiceQuick"
                        checked={!onlyFavorites && !onlyPopular}
                        onChange={() => {
                          setOnlyFavorites(false);
                          setOnlyPopular(false);
                        }}
                        className="accent-amber-400"
                      />
                      Все
                    </label>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Теги стиля</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTag(null)}
                        className={[
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                          selectedTag === null
                            ? "border-amber-400/40 bg-amber-500/15 text-amber-50"
                            : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/15",
                        ].join(" ")}
                      >
                        Все
                      </button>
                      {tagFrequency.map(([tag]) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSelectedTag((cur) => (cur === tag ? null : tag))}
                          className={[
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize transition",
                            selectedTag === tag
                              ? "border-amber-400/40 bg-amber-500/15 text-amber-50"
                              : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/15",
                          ].join(" ")}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>

              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <p className="text-sm text-zinc-300">
                    Найдено голосов: <span className="font-semibold text-white">{filtered.length}</span>
                    {loadError ? <span className="ml-2 text-red-300">({loadError})</span> : null}
                  </p>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="hidden sm:inline">Сортировка</span>
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as typeof sort)}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400/35"
                    >
                      <option value="popularity">По популярности</option>
                      <option value="name">По имени</option>
                    </select>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {loading ? (
                    <p className="text-sm text-zinc-400">Загрузка каталога…</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {filtered.map((v) => {
                        const selected = selectedId === v.id;
                        const accent = accentPill(v.locale);
                        const fav = favoriteIds.has(v.id);

                        return (
                          <div
                            key={v.id}
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
                              "relative flex h-full cursor-pointer flex-col rounded-2xl border bg-[#1b1b1e] p-4 text-left transition outline-none",
                              selected
                                ? "border-amber-400/55 shadow-[0_0_0_1px_rgba(251,191,36,0.18)]"
                                : "border-white/10 hover:border-white/15",
                            ].join(" ")}
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <VoiceAvatar seed={v.id} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white">{v.name}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center gap-0.5 text-amber-300/90">
                                      {Array.from({ length: popularityDots(v) }).map((_, i) => (
                                        <Flame key={i} className="h-3.5 w-3.5" />
                                      ))}
                                    </span>
                                    <span
                                      className={[
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                        accent.className,
                                      ].join(" ")}
                                    >
                                      {accent.label}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => toggleFavorite(v.id, e)}
                                className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-1.5 text-zinc-400 transition hover:bg-white/10"
                                aria-label="Избранное"
                              >
                                <Heart className={["h-4 w-4", fav ? "fill-amber-300/40 text-amber-200" : ""].join(" ")} />
                              </button>
                            </div>

                            <div className="mb-3 flex flex-wrap gap-1.5">
                              {(v.voice_style_tags ?? []).slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] capitalize text-zinc-300"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>

                            <p className="mb-4 line-clamp-2 flex-1 text-xs leading-5 text-zinc-500">
                              Использований: {v.usage_count.toLocaleString("ru-RU")} • {v.locale}
                            </p>

                            <button
                              type="button"
                              disabled={!v.preview_audio_url}
                              onClick={(e) => {
                                e.stopPropagation();
                                playPreview(v);
                              }}
                              className={[
                                "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                                playingId === v.id
                                  ? "border-sky-400/40 bg-sky-500/10 text-sky-100"
                                  : "border-white/10 bg-white/5 text-zinc-200 hover:border-amber-400/25 hover:bg-amber-500/10 hover:text-amber-50",
                                !v.preview_audio_url ? "cursor-not-allowed opacity-50" : "",
                              ].join(" ")}
                            >
                              <Play className="h-3.5 w-3.5 text-amber-300" />
                              {playingId === v.id ? "Остановить" : "Прослушать"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 bg-black/25 px-4 py-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
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
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    Выбрать
                  </button>
                </footer>
              </section>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function VoiceAvatar({ seed }: { seed: string }) {
  const hue = (seed.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360) || 260;
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-xs font-bold text-white"
      style={{
        background: `linear-gradient(135deg, hsla(${hue}, 85%, 62%, 0.55), hsla(${(hue + 40) % 360}, 85%, 55%, 0.45))`,
      }}
    >
      {seed.slice(0, 2).toUpperCase()}
    </div>
  );
}
