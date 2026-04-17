import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getApiSessionUser } from "../../../lib/auth/api-session";
import { isValidUserReferenceImageUrl } from "../../../lib/generation-reference";
import { getMaintenanceState } from "../../../lib/maintenance";
import { hasActiveSubscription } from "../../../lib/subscription";
import type { AspectRatio } from "../../../features/dashboard/types";

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

export async function GET() {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await db.generation.findMany({
    where: { userId: sessionUser.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(items);
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
  const aspectRatio =
    body.aspectRatio === "16:9" ||
    body.aspectRatio === "4:3" ||
    body.aspectRatio === "1:1" ||
    body.aspectRatio === "3:4" ||
    body.aspectRatio === "9:16"
      ? body.aspectRatio
      : null;

  if (!modelId || !modelName || !aspectRatio) {
    return NextResponse.json({ error: "Укажите модель и формат" }, { status: 400 });
  }

  if (modelId === "voice" && (!voiceId || !voiceName)) {
    return NextResponse.json({ error: "Выберите голос" }, { status: 400 });
  }

  let inputMode: "TEXT" | "IMAGE_REF" = "TEXT";
  let referenceImageUrl: string | null = null;

  if (modelId === "photo" || modelId === "video") {
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
      ? mergeVoicePrompt(prompt, `${voiceName} (${voiceId})`)
      : inputMode === "IMAGE_REF" && !prompt.trim()
        ? "—"
        : prompt;

  const generation = await db.generation.create({
    data: {
      modelId,
      modelName,
      inputMode: modelId === "voice" ? "TEXT" : inputMode,
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
