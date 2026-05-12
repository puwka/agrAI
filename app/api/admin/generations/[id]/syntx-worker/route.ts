import { NextResponse } from "next/server";

import { db } from "../../../../../../lib/db";
import { getApiSessionUser } from "../../../../../../lib/auth/api-session";
import { isSyntxGeneration, mapSyntxJob } from "../../../../../../lib/automation-worker";

async function resetToPending(id: string, errorMessage: string) {
  try {
    await db.generation.update({
      where: { id },
      data: {
        status: "PENDING",
        errorMessage,
      },
    });
  } catch {
    // Best effort: the admin API response still reports trigger failure.
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const generationId = rawId?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  const generation = await db.generation.findUnique({ where: { id: generationId } });
  if (!generation || !isSyntxGeneration(generation)) {
    return NextResponse.json({ error: "Это не заявка Syntx (Veo 3.1 Relax или Sora image)" }, { status: 404 });
  }

  if (generation.status === "SUCCESS") {
    return NextResponse.json({ error: "Заявка уже завершена" }, { status: 409 });
  }
  if (generation.status === "PROCESSING") {
    return NextResponse.json({ error: "Заявка уже передана воркеру" }, { status: 409 });
  }

  const claimed = await db.generation.updateWhere({
    where: {
      id: generationId,
      status: { in: ["PENDING", "QUEUED", "ERROR"] },
    },
    data: {
      status: "PROCESSING",
      errorMessage: null,
    },
  });
  const row = claimed[0];
  if (!row) {
    return NextResponse.json({ error: "Не удалось передать заявку воркеру" }, { status: 409 });
  }

  const job = mapSyntxJob(row);
  const triggerUrl = process.env.SYNTX_WORKER_TRIGGER_URL?.trim() ?? "";
  if (!triggerUrl) {
    await resetToPending(generationId, "SYNTX_WORKER_TRIGGER_URL не настроен");
    return NextResponse.json(
      { error: "SYNTX_WORKER_TRIGGER_URL не настроен", job },
      { status: 503 },
    );
  }

  const token =
    process.env.SYNTX_WORKER_TRIGGER_TOKEN?.trim() ||
    process.env.SYNTX_WORKER_TOKEN?.trim() ||
    process.env.AUTOMATION_WORKER_TOKEN?.trim() ||
    "";

  try {
    const response = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ job }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      await resetToPending(generationId, `Syntx worker trigger failed: ${response.status}`);
      return NextResponse.json(
        {
          error: "Воркер не принял заявку",
          detail: text.slice(0, 1000),
          job,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    await resetToPending(generationId, `Syntx worker trigger failed: ${detail}`.slice(0, 1000));
    return NextResponse.json(
      { error: "Не удалось вызвать Syntx worker", detail, job },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, job });
}
