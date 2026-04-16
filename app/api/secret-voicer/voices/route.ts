import { NextResponse } from "next/server";

import premadeCatalog from "../../../../lib/elevenlabs-premade-voices.json";

const VOICES_URL = "https://secretvoicer.com/api/public/showcase-voices-filtered/";
const SHOWCASE_FETCH_URLS = [
  VOICES_URL,
  `${VOICES_URL}?gender=MALE`,
  `${VOICES_URL}?gender=FEMALE`,
] as const;

type UpstreamVoice = {
  id?: string;
  voice_id?: string;
  name?: string;
  gender?: string;
  locale?: string;
  preview_audio_url?: string;
  voice_style_tags?: string[];
  usage_count?: number;
};

type NormalizedVoice = {
  id: string;
  name: string;
  gender: string;
  locale: string;
  preview_audio_url: string;
  voice_style_tags: string[];
  usage_count: number;
};

function toAbsoluteMediaUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return new URL(trimmed, "https://secretvoicer.com").toString();
}

function normalizeUpstreamVoice(v: UpstreamVoice): NormalizedVoice | null {
  const id = String(v.voice_id ?? v.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: v.name ?? "—",
    gender: v.gender ?? "",
    locale: v.locale ?? "",
    preview_audio_url: toAbsoluteMediaUrl(v.preview_audio_url ?? ""),
    voice_style_tags: v.voice_style_tags ?? [],
    usage_count: typeof v.usage_count === "number" ? v.usage_count : 0,
  };
}

function mergeVoicePreferSv(existing: NormalizedVoice, incoming: NormalizedVoice): NormalizedVoice {
  const usage = Math.max(existing.usage_count, incoming.usage_count);
  const pick =
    incoming.usage_count > existing.usage_count ||
    (incoming.usage_count === existing.usage_count && incoming.name.length > existing.name.length)
      ? incoming
      : existing;
  const tagSet = new Set<string>([...existing.voice_style_tags, ...incoming.voice_style_tags]);
  return {
    ...pick,
    usage_count: usage,
    voice_style_tags: [...tagSet],
  };
}

export async function GET() {
  const upstreamResults = await Promise.allSettled(
    SHOWCASE_FETCH_URLS.map((url) =>
      fetch(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${url} → ${r.status}`);
        return (await r.json()) as {
          voices?: UpstreamVoice[];
          total_count?: number;
        };
      }),
    ),
  );

  const firstOk = upstreamResults.find((r) => r.status === "fulfilled") as
    | PromiseFulfilledResult<{ voices?: UpstreamVoice[]; total_count?: number }>
    | undefined;

  if (!firstOk) {
    const reason = upstreamResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return NextResponse.json(
      { error: "Не удалось загрузить голоса Secret Voicer", detail: String(reason?.reason ?? "") },
      { status: 502 },
    );
  }

  const secretVoicerHint =
    typeof firstOk.value.total_count === "number" ? firstOk.value.total_count : undefined;

  const byId = new Map<string, NormalizedVoice>();

  for (const result of upstreamResults) {
    if (result.status !== "fulfilled") continue;
    const list = result.value.voices ?? [];
    for (const raw of list) {
      const v = normalizeUpstreamVoice(raw);
      if (!v) continue;
      const prev = byId.get(v.id);
      byId.set(v.id, prev ? mergeVoicePreferSv(prev, v) : v);
    }
  }

  const premade = premadeCatalog as { voices: NormalizedVoice[] };
  for (const p of premade.voices) {
    if (!p.id || byId.has(p.id)) continue;
    byId.set(p.id, {
      id: p.id,
      name: p.name,
      gender: p.gender,
      locale: p.locale,
      preview_audio_url: p.preview_audio_url,
      voice_style_tags: p.voice_style_tags ?? [],
      usage_count: typeof p.usage_count === "number" ? p.usage_count : 0,
    });
  }

  const voices = [...byId.values()].sort((a, b) => {
    if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
    return a.name.localeCompare(b.name, "ru");
  });

  return NextResponse.json({
    voices,
    total_count: voices.length,
    secret_voicer_public_total_hint: secretVoicerHint,
    sources: [...SHOWCASE_FETCH_URLS, "elevenlabs-premade-voices.json"],
  });
}
