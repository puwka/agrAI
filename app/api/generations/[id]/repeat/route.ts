import { NextResponse } from "next/server";

import { db } from "../../../../../lib/db";
import { getApiSessionUser } from "../../../../../lib/auth/api-session";
import { getMaintenanceState } from "../../../../../lib/maintenance";
import { hasActiveSubscription } from "../../../../../lib/subscription";
import { resolveVoicePromptLocal } from "../../../../../lib/voice-prompt-local";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const sourceGenerationId = rawId?.trim();
  if (!sourceGenerationId) {
    return NextResponse.json({ error: "Некорректный id генерации" }, { status: 400 });
  }

  if (sessionUser.role !== "ADMIN") {
    const maintenance = await getMaintenanceState();
    if (maintenance.enabled) {
      return NextResponse.json(
        { error: "Технические работы", maintenanceMessage: maintenance.message },
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
      where: { userId: sessionUser.id, status: { in: ["PENDING", "QUEUED"] } },
      select: { id: true },
    });
    if (unfinished) {
      return NextResponse.json(
        { error: "У вас уже есть заявка в работе. Дождитесь результата и попробуйте снова." },
        { status: 409 },
      );
    }
  }

  const source = await db.generation.findFirst({
    where: {
      id: sourceGenerationId,
      ...(sessionUser.role === "ADMIN" ? {} : { userId: sessionUser.id }),
    },
  });
  if (!source) {
    return NextResponse.json({ error: "Исходная генерация не найдена" }, { status: 404 });
  }

  let repeatedPrompt = `${source.prompt ?? ""}\n[Repeat]`;
  const isVeo31Relax =
    source.modelId === "video" && (source.modelName ?? "").toLowerCase().includes("veo 3.1");
  if (isVeo31Relax && !/\[VeoResolution:(720p|1080p)\]/i.test(repeatedPrompt)) {
    repeatedPrompt = `${repeatedPrompt}\n[VeoResolution:1080p]`;
  }

  const repeated = await db.generation.create({
    data: {
      modelId: source.modelId,
      // Важно: оставляем modelName без модификаций, потому что воркер
      // определяет маршрут обработки по оригинальному имени модели.
      modelName: source.modelName ?? "",
      inputMode: source.inputMode ?? "TEXT",
      referenceImageUrl: source.referenceImageUrl ?? null,
      prompt: repeatedPrompt,
      aspectRatio: source.aspectRatio,
      status: "PENDING",
      resultUrl: null,
      resultMessage: null,
      errorMessage: null,
      user: { connect: { id: source.userId } },
    },
  });

  const sourcePromptResolved =
    source.modelId === "voice"
      ? await resolveVoicePromptLocal(source.prompt ?? "")
      : source.prompt ?? "";

  return NextResponse.json({
    ...repeated,
    repeatedFromId: source.id,
    sourcePrompt: sourcePromptResolved,
    sourceAspectRatio: source.aspectRatio,
    sourceInputMode: source.inputMode ?? "TEXT",
    sourceReferenceImageUrl: source.referenceImageUrl ?? null,
  });
}
