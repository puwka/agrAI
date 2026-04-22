import { NextResponse } from "next/server";

import premadeCatalog from "../../../../lib/elevenlabs-premade-voices.json";

const TOP_VOICES_LIMIT = 100;

let voicesCache:
  | {
      expiresAt: number;
      payload: {
        voices: Array<NormalizedVoice & { hidden: boolean }>;
        total_count: number;
        sources: string[];
      };
    }
  | null = null;

type NormalizedVoice = {
  id: string;
  name: string;
  gender: string;
  locale: string;
  preview_audio_url: string;
  voice_style_tags: string[];
  usage_count: number;
};

function shouldProxyPreview(url: string) {
  const v = url.trim();
  if (!v) return false;
  if (v.startsWith("/")) return false;
  if (v.startsWith("/api/voice-preview?u=")) return false;
  return v.startsWith("http://") || v.startsWith("https://");
}

function toPreviewClientUrl(url: string) {
  const normalized = toAbsoluteMediaUrl(url);
  if (!shouldProxyPreview(normalized)) return normalized;
  return `/api/voice-preview?u=${encodeURIComponent(normalized)}`;
}

function toAbsoluteMediaUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const absolute = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : url;
  // На HTTPS-сайте http-аудио может блокироваться как mixed content.
  return absolute.replace(/^http:\/\//i, "https://");
}
function normalizePremadeVoice(v: Partial<NormalizedVoice>): NormalizedVoice | null {
  const id = String(v.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: String(v.name ?? "—"),
    gender: String(v.gender ?? ""),
    locale: String(v.locale ?? ""),
    preview_audio_url: toPreviewClientUrl(v.preview_audio_url ?? ""),
    voice_style_tags: Array.isArray(v.voice_style_tags) ? v.voice_style_tags.map((t) => String(t)) : [],
    usage_count: typeof v.usage_count === "number" ? v.usage_count : 0,
  };
}

export async function GET(request: Request) {
  const includeHidden = new URL(request.url).searchParams.get("includeHidden") === "1";
  return getVoicesResponse(includeHidden);
}

async function getVoicesResponse(includeHidden: boolean) {
  if (!includeHidden && voicesCache && voicesCache.expiresAt > Date.now()) {
    return NextResponse.json(voicesCache.payload);
  }

  const premade = premadeCatalog as { voices?: Array<Partial<NormalizedVoice>> };
  const normalized = (premade.voices ?? [])
    .map((v) => normalizePremadeVoice(v))
    .filter((v): v is NormalizedVoice => Boolean(v));

  const byId = new Map<string, NormalizedVoice>();
  for (const v of normalized) {
    if (!byId.has(v.id)) byId.set(v.id, v);
  }

  const voices = [...byId.values()]
    .sort((a, b) => {
      if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
      return a.name.localeCompare(b.name, "ru");
    })
    .slice(0, TOP_VOICES_LIMIT)
    .map((v) => ({ ...v, hidden: false }));

  const visibleVoices = includeHidden ? voices : voices;
  const payload = {
    voices: visibleVoices,
    total_count: visibleVoices.length,
    sources: ["elevenlabs-premade-voices.json"],
  };
  if (!includeHidden) {
    voicesCache = { expiresAt: Date.now() + 60_000, payload };
  }
  return NextResponse.json(payload);
}
