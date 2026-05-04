import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getApiSessionUser } from "../../../lib/auth/api-session";
import { isValidUserReferenceImageUrl } from "../../../lib/generation-reference";
import { getMaintenanceState } from "../../../lib/maintenance";
import { hasActiveSubscription } from "../../../lib/subscription";
import type { AspectRatio } from "../../../features/dashboard/types";

const GENERATIONS_CACHE_TTL_MS = 8000;
const generationsListCache = new Map<string, { expiresAt: number; payload: unknown }>();
const MAX_VOICE_PROMPT_CHARS = 4000;

function extractErrorText(error: unknown): string {
  const chunks: string[] = [];
  const push = (value: unknown) => {
    if (value == null) return;
    if (typeof value === "string") {
      const t = value.trim();
      if (t) chunks.push(t);
      return;
    }
    if (value instanceof Error) {
      push(value.message);
      push((value as Error & { cause?: unknown }).cause);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      push(obj.error);
      push(obj.message);
      push(obj.details);
      push(obj.detail);
      push(obj.hint);
      push(obj.code);
      push(obj.cause);
      return;
    }
    push(String(value));
  };
  push(error);
  return chunks.join(" | ").trim();
}

function isTransientWriteError(error: unknown): boolean {
  const text = extractErrorText(error).toLowerCase();
  return (
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("fetch failed") ||
    text.includes("terminated") ||
    text.includes("aborted") ||
    text.includes("supabase_timeout") ||
    text.includes("socket hang up")
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const code = typeof obj.code === "string" ? obj.code : "";
    if (code === "23505") return true;
  }
  const text = extractErrorText(error).toLowerCase();
  return text.includes("duplicate key") || text.includes("already exists") || text.includes("23505");
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidHttpUrlForTranscription(link: string): boolean {
  const s = link.trim();
  if (!s || s.length > 4000) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function mergeVoicePrompt(prompt: string, voiceName?: string | null) {
  const base = typeof prompt === "string" ? prompt : "";
  const name = voiceName?.trim();
  if (!name) return base;

  const prefix = `[Голос: ${name}]`;
  const trimmed = base.trimStart();
  if (trimmed.startsWith(prefix)) {
    return base;
  }
  return `${prefix}\n${base}`;
}

function extractPhotoRefsFromPrompt(prompt: string): string[] {
  const out: string[] = [];
  const re = /\[RefImage:(.+?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt ?? "")) !== null) {
    const raw = (m[1] ?? "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function appendPhotoRefsToPrompt(prompt: string, refs: string[]): string {
  const cleanRefs = refs.map((x) => x.trim()).filter(Boolean);
  if (cleanRefs.length <= 1) return prompt;
  const markers = cleanRefs.slice(1).map((url) => `[RefImage:${url}]`).join("\n");
  return `${prompt}\n${markers}`;
}

function generationListWhere(
  userId: string,
  statusFilter: string,
): { userId: string; status?: string | { in: string[] } } {
  const base = { userId } as { userId: string; status?: string | { in: string[] } };
  if (!statusFilter || statusFilter === "all") return base;
  if (statusFilter === "success") {
    base.status = "SUCCESS";
    return base;
  }
  if (statusFilter === "error") {
    base.status = "ERROR";
    return base;
  }
  if (statusFilter === "queued") {
    base.status = { in: ["PENDING", "QUEUED"] };
    return base;
  }
  return base;
}

export async function GET(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 100);
  const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);
  const statusRaw = (searchParams.get("status") ?? "").trim().toLowerCase();
  const statusFilter =
    statusRaw === "success" || statusRaw === "error" || statusRaw === "queued" || statusRaw === "all"
      ? statusRaw
      : "all";
  const q = (searchParams.get("q") ?? "").trim();
  const brief = searchParams.get("brief") === "1";
  const includeTotal = searchParams.get("includeTotal") === "1";
  const cacheKey = [
    sessionUser.id,
    limit,
    offset,
    statusFilter,
    q,
    brief ? "1" : "0",
    includeTotal ? "1" : "0",
  ].join("|");
  const now = Date.now();
  const cached = generationsListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=8" },
    });
  }

  const where = generationListWhere(sessionUser.id, statusFilter);

  const itemsRaw = await db.generation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    search: q || undefined,
    select: brief
      ? {
          id: true,
          modelName: true,
          prompt: true,
          aspectRatio: true,
          status: true,
          resultUrl: true,
          resultMessage: true,
          errorMessage: true,
          createdAt: true,
        }
      : undefined,
  });
  const total = includeTotal
    ? await db.generation.countWhere({
        where,
        search: q || undefined,
      })
    : undefined;

  const items = brief
    ? (itemsRaw as Array<{ prompt?: string; resultMessage?: string; errorMessage?: string }>).map((item) => {
        const prompt = typeof item.prompt === "string" ? item.prompt : "";
        const resultMessage = typeof item.resultMessage === "string" ? item.resultMessage : "";
        const errorMessage = typeof item.errorMessage === "string" ? item.errorMessage : "";
        return {
          ...item,
          prompt: prompt.length > 280 ? `${prompt.slice(0, 280)}…` : prompt,
          resultMessage: resultMessage.length > 500 ? `${resultMessage.slice(0, 500)}…` : resultMessage,
          errorMessage: errorMessage.length > 500 ? `${errorMessage.slice(0, 500)}…` : errorMessage,
        };
      })
    : itemsRaw;

  const payload = {
    items,
    ...(typeof total === "number" ? { total } : {}),
    hasMore: itemsRaw.length === limit,
  };
  generationsListCache.set(cacheKey, { expiresAt: now + GENERATIONS_CACHE_TTL_MS, payload });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=8" },
  });
}

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (sessionUser.role !== "ADMIN") {
    const maintenance = await getMaintenanceState();
    if (maintenance.enabled) {
      return NextResponse.json(
        {
          error: "Технические работы",
          maintenanceMessage: maintenance.message,
        },
        { status: 503 },
      );
    }

    const restriction = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: { restrictedUntil: true, restrictedReason: true, subscriptionUntil: true },
    });

    const now = new Date();
    if (restriction?.restrictedUntil && restriction.restrictedUntil.getTime() > now.getTime()) {
      return NextResponse.json(
        {
          error: restriction.restrictedReason?.trim() || "Злоупотребление генерациями.",
          restrictedUntil: restriction.restrictedUntil,
        },
        { status: 403 },
      );
    }

    if (!hasActiveSubscription(sessionUser.role, restriction?.subscriptionUntil ?? null)) {
      return NextResponse.json(
        {
          error: "Подписка закончилась. Обратитесь к администратору для продления.",
          subscriptionExpired: true,
          subscriptionUntil: restriction?.subscriptionUntil ?? null,
        },
        { status: 403 },
      );
    }

    const unfinished = await db.generation.findFirst({
      where: {
        userId: sessionUser.id,
        status: { in: ["PENDING", "QUEUED"] },
      },
      select: { id: true },
    });

    if (unfinished) {
      return NextResponse.json(
        {
          error:
            "У вас уже есть заявка в работе. Дождитесь результата — затем можно отправить новую заявку, выбрав любую модель.",
        },
        { status: 409 },
      );
    }
  }

  let body: {
    clientRequestId?: string;
    modelId?: string;
    modelName?: string;
    prompt?: string;
    aspectRatio?: string;
    voiceId?: string;
    voiceName?: string;
    inputMode?: string;
    referenceImageUrl?: string | null;
    referenceImageUrls?: string[] | null;
    enhanceQuality?: string;
    enhanceFps?: string;
    motionVideoUrl?: string | null;
    motionVideoDurationSec?: number;
    runwayDurationSec?: number;
    veoResolution?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const modelId = body.modelId?.trim();
  const modelName = body.modelName?.trim();
  const clientRequestIdRaw = typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const voiceName = typeof body.voiceName === "string" ? body.voiceName.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  let aspectRatio: AspectRatio | null =
    body.aspectRatio === "21:9" ||
    body.aspectRatio === "16:9" ||
    body.aspectRatio === "4:3" ||
    body.aspectRatio === "3:2" ||
    body.aspectRatio === "1:1" ||
    body.aspectRatio === "2:3" ||
    body.aspectRatio === "3:4" ||
    body.aspectRatio === "9:16"
      ? body.aspectRatio
      : null;

  if ((modelId === "transcription" || modelId === "video-enhance" || modelId === "motion-transfer") && !aspectRatio) {
    aspectRatio = "16:9";
  }

  if (!modelId || !modelName || !aspectRatio) {
    return NextResponse.json({ error: "Укажите модель и формат" }, { status: 400 });
  }

  const clientRequestId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestIdRaw)
      ? clientRequestIdRaw
      : "";

  if (sessionUser.role !== "ADMIN") {
    const lockMap = await db.modelLock.listMap();
    const lock = lockMap[modelId];
    if (lock?.enabled) {
      return NextResponse.json(
        { error: lock.message || "Модель временно недоступна. Попробуйте позже." },
        { status: 403 },
      );
    }
  }

  if (modelId === "voice" && (!voiceId || !voiceName)) {
    return NextResponse.json({ error: "Выберите голос" }, { status: 400 });
  }

  let inputMode: "TEXT" | "IMAGE_REF" = "TEXT";
  let referenceImageUrl: string | null = null;
  let promptToStore = prompt;
  const enhanceQualityRaw = typeof body.enhanceQuality === "string" ? body.enhanceQuality.trim().toLowerCase() : "";
  const enhanceFpsRaw = typeof body.enhanceFps === "string" ? body.enhanceFps.trim() : "";

  if (modelId === "transcription") {
    const refT = typeof body.referenceImageUrl === "string" ? body.referenceImageUrl.trim() : "";
    const hasFile = await isValidUserReferenceImageUrl(refT, sessionUser.id);
    const link = prompt.trim();
    const hasLink = isValidHttpUrlForTranscription(link);
    if (!hasFile && !hasLink) {
      return NextResponse.json(
        { error: "Укажите ссылку на видео/аудио или загрузите файл." },
        { status: 400 },
      );
    }
    referenceImageUrl = hasFile ? refT : null;
    if (hasLink && hasFile) {
      promptToStore = `Ссылка: ${link}\nДополнительно загружен файл (см. источник ниже).`;
    } else if (hasLink) {
      promptToStore = link;
    } else {
      promptToStore = "Файл для транскрибации (см. источник ниже).";
    }
  } else if (modelId === "video-enhance") {
    const refV = typeof body.referenceImageUrl === "string" ? body.referenceImageUrl.trim() : "";
    const hasVideo = await isValidUserReferenceImageUrl(refV, sessionUser.id);
    if (!hasVideo) {
      return NextResponse.json({ error: "Загрузите видео для улучшения." }, { status: 400 });
    }
    const quality = enhanceQualityRaw === "2x" || enhanceQualityRaw === "4x" ? enhanceQualityRaw : "original";
    const fps = ["24", "25", "30", "45", "50", "60"].includes(enhanceFpsRaw) ? enhanceFpsRaw : "60";
    referenceImageUrl = refV;
    promptToStore = `[Topaz]\nКачество: ${quality}\nFPS: ${fps}`;
  } else if (modelId === "motion-transfer") {
    const characterUrl = typeof body.referenceImageUrl === "string" ? body.referenceImageUrl.trim() : "";
    const motionVideoUrl = typeof body.motionVideoUrl === "string" ? body.motionVideoUrl.trim() : "";
    const hasCharacter = await isValidUserReferenceImageUrl(characterUrl, sessionUser.id);
    const hasVideo = await isValidUserReferenceImageUrl(motionVideoUrl, sessionUser.id);
    const durationSec =
      typeof body.motionVideoDurationSec === "number" && Number.isFinite(body.motionVideoDurationSec)
        ? body.motionVideoDurationSec
        : 0;
    if (!hasCharacter) {
      return NextResponse.json({ error: "Загрузите персонажа." }, { status: 400 });
    }
    if (!hasVideo) {
      return NextResponse.json({ error: "Загрузите видео для переноса движений." }, { status: 400 });
    }
    if (durationSec < 3 || durationSec > 30) {
      return NextResponse.json({ error: "Видео должно быть от 3 до 30 секунд." }, { status: 400 });
    }
    referenceImageUrl = characterUrl;
    promptToStore = `[Runway Act-Two]
[MotionVideo:${motionVideoUrl}]
[DurationSec:${Math.round(durationSec)}]
[AspectRatio:${aspectRatio}]`;
  } else if (modelId === "photo" || modelId === "video") {
    const rawMode = body.inputMode?.trim().toUpperCase();
    if (rawMode === "IMAGE_REF" || rawMode === "IMAGE") {
      inputMode = "IMAGE_REF";
    }
    const ref = typeof body.referenceImageUrl === "string" ? body.referenceImageUrl.trim() : "";
    const refsRaw = Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls : [];
    const refsNormalized = refsRaw.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
    const requestedRunwayDuration =
      modelId === "video" && typeof body.runwayDurationSec === "number" && Number.isFinite(body.runwayDurationSec)
        ? Math.round(body.runwayDurationSec)
        : null;
    const maxRefsAllowed = modelId === "video" && (requestedRunwayDuration === 5 || requestedRunwayDuration === 10) ? 1 : 3;

    if (inputMode === "IMAGE_REF") {
      const refs = refsNormalized.length > 0 ? refsNormalized : ref ? [ref] : [];
      if (refs.length === 0) {
        return NextResponse.json(
          { error: "Загрузите исходное фото для режима «из фото»." },
          { status: 400 },
        );
      }
      if (refs.length > maxRefsAllowed) {
        return NextResponse.json(
          {
            error:
              maxRefsAllowed === 1
                ? "Для Runway Gen-4 можно загрузить только 1 фото."
                : "Можно загрузить не более 3 фото.",
          },
          { status: 400 },
        );
      }
      const validRefs: string[] = [];
      for (const item of refs) {
        if (!(await isValidUserReferenceImageUrl(item, sessionUser.id))) {
          return NextResponse.json(
            { error: "Некоторые изображения недоступны. Загрузите их заново." },
            { status: 400 },
          );
        }
        validRefs.push(item);
      }
      referenceImageUrl = validRefs[0] ?? null;
      promptToStore = appendPhotoRefsToPrompt(promptToStore, validRefs);
    } else {
      if (!prompt.trim()) {
        return NextResponse.json(
          { error: "Введите описание для генерации из текста." },
          { status: 400 },
        );
      }
    }
  }

  if (modelId === "video") {
    const runwayDurationRaw =
      typeof body.runwayDurationSec === "number" && Number.isFinite(body.runwayDurationSec)
        ? Math.round(body.runwayDurationSec)
        : null;
    if (runwayDurationRaw === 5 || runwayDurationRaw === 10) {
      promptToStore = `${promptToStore}\n[RunwayDurationSec:${runwayDurationRaw}]`;
    } else {
      const vrRaw = typeof body.veoResolution === "string" ? body.veoResolution.trim().toLowerCase() : "";
      if (vrRaw === "720p" || vrRaw === "1080p") {
        promptToStore = `${promptToStore}\n[VeoResolution:${vrRaw}]`;
      }
    }
  }

  const storedPrompt =
    modelId === "voice"
      ? mergeVoicePrompt(prompt, voiceName)
      : modelId === "photo" || modelId === "video"
        ? inputMode === "IMAGE_REF" && !prompt.trim() && extractPhotoRefsFromPrompt(promptToStore).length === 0
          ? "—"
          : promptToStore
        : promptToStore;

  if (modelId === "voice" && typeof storedPrompt === "string" && storedPrompt.length > MAX_VOICE_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `Текст для озвучки не длиннее ${MAX_VOICE_PROMPT_CHARS} символов.` },
      { status: 400 },
    );
  }

  let generation;
  let lastWriteError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      generation = await db.generation.create({
        data: {
          ...(clientRequestId ? { id: clientRequestId } : {}),
          modelId,
          modelName,
          inputMode: modelId === "voice" || modelId === "transcription" || modelId === "video-enhance" || modelId === "motion-transfer" ? "TEXT" : inputMode,
          referenceImageUrl: modelId === "voice" ? null : referenceImageUrl,
          prompt: storedPrompt,
          aspectRatio,
          status: "PENDING",
          resultUrl: null,
          user: { connect: { id: sessionUser.id } },
        },
      });
      break;
    } catch (error) {
      lastWriteError = error;
      // Если id уже существует — значит это повтор того же запроса. Возвращаем существующую запись.
      if (clientRequestId && isDuplicateKeyError(error)) {
        for (let gAttempt = 1; gAttempt <= 4; gAttempt += 1) {
          try {
            const existing = await db.generation.findUnique({ where: { id: clientRequestId } });
            if (existing) {
              generation = existing;
              break;
            }
          } catch (e) {
            if (gAttempt < 4 && isTransientWriteError(e)) {
              await wait(200 * gAttempt);
              continue;
            }
            break;
          }
          await wait(120 * gAttempt);
        }
        if (generation) break;
      }
      // Идемпотентность: если запись уже создалась с тем же id — просто вернём её.
      if (clientRequestId) {
        try {
          const existing = await db.generation.findUnique({ where: { id: clientRequestId } });
          if (existing) {
            generation = existing;
            break;
          }
        } catch {
          // ignore and continue regular retry logic
        }
      }
      if (attempt < 3 && isTransientWriteError(error)) {
        await wait(300 * attempt);
        continue;
      }
      break;
    }
  }
  if (!generation) {
    const detail = extractErrorText(lastWriteError) || "unknown_error";
    return NextResponse.json({ error: "Не удалось сохранить заявку", detail }, { status: 503 });
  }

  // Invalidate list cache for fresh user/admin listings after new request.
  for (const key of generationsListCache.keys()) {
    if (key.startsWith(`${sessionUser.id}|`)) {
      generationsListCache.delete(key);
    }
  }

  return NextResponse.json(generation);
}
