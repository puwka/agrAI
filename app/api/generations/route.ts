import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getApiSessionUser } from "../../../lib/auth/api-session";
import { isValidUserReferenceImageUrl } from "../../../lib/generation-reference";
import { getMaintenanceState } from "../../../lib/maintenance";
import { hasActiveSubscription } from "../../../lib/subscription";
import type { AspectRatio } from "../../../features/dashboard/types";

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

  const where = generationListWhere(sessionUser.id, statusFilter);

  const [items, total] = await Promise.all([
    db.generation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      search: q || undefined,
    }),
    db.generation.countWhere({
      where,
      search: q || undefined,
    }),
  ]);

  return NextResponse.json({ items, total });
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
    modelId?: string;
    modelName?: string;
    prompt?: string;
    aspectRatio?: string;
    voiceId?: string;
    voiceName?: string;
    inputMode?: string;
    referenceImageUrl?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const modelId = body.modelId?.trim();
  const modelName = body.modelName?.trim();
  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const voiceName = typeof body.voiceName === "string" ? body.voiceName.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  let aspectRatio: AspectRatio | null =
    body.aspectRatio === "16:9" ||
    body.aspectRatio === "4:3" ||
    body.aspectRatio === "1:1" ||
    body.aspectRatio === "3:4" ||
    body.aspectRatio === "9:16"
      ? body.aspectRatio
      : null;

  if (modelId === "transcription" && !aspectRatio) {
    aspectRatio = "16:9";
  }

  if (!modelId || !modelName || !aspectRatio) {
    return NextResponse.json({ error: "Укажите модель и формат" }, { status: 400 });
  }

  if (modelId === "voice" && (!voiceId || !voiceName)) {
    return NextResponse.json({ error: "Выберите голос" }, { status: 400 });
  }

  let inputMode: "TEXT" | "IMAGE_REF" = "TEXT";
  let referenceImageUrl: string | null = null;
  let promptToStore = prompt;

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
  } else if (modelId === "photo" || modelId === "video") {
    const rawMode = body.inputMode?.trim().toUpperCase();
    if (rawMode === "IMAGE_REF" || rawMode === "IMAGE") {
      inputMode = "IMAGE_REF";
    }
    const ref =
      typeof body.referenceImageUrl === "string" ? body.referenceImageUrl.trim() : "";

    if (inputMode === "IMAGE_REF") {
      if (!(await isValidUserReferenceImageUrl(ref, sessionUser.id))) {
        return NextResponse.json(
          { error: "Загрузите исходное фото для режима «из фото»." },
          { status: 400 },
        );
      }
      referenceImageUrl = ref;
    } else {
      if (!prompt.trim()) {
        return NextResponse.json(
          { error: "Введите описание для генерации из текста." },
          { status: 400 },
        );
      }
    }
  }

  const storedPrompt =
    modelId === "voice"
      ? mergeVoicePrompt(prompt, voiceName)
      : modelId === "photo" || modelId === "video"
        ? inputMode === "IMAGE_REF" && !prompt.trim()
          ? "—"
          : prompt
        : promptToStore;

  const generation = await db.generation.create({
    data: {
      modelId,
      modelName,
      inputMode: modelId === "voice" || modelId === "transcription" ? "TEXT" : inputMode,
      referenceImageUrl: modelId === "voice" ? null : referenceImageUrl,
      prompt: storedPrompt,
      aspectRatio,
      status: "PENDING",
      resultUrl: null,
      user: { connect: { id: sessionUser.id } },
    },
  });

  return NextResponse.json(generation);
}
