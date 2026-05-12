import { NextResponse } from "next/server";

import { db } from "../../../../../../../lib/db";
import { isSyntxGeneration, requireAutomationWorker } from "../../../../../../../lib/automation-worker";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const forbidden = requireAutomationWorker(request);
  if (forbidden) return forbidden;

  const { id: rawId } = await context.params;
  const generationId = rawId?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  let body: { error?: string; detail?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const generation = await db.generation.findUnique({ where: { id: generationId } });
  if (!generation || !isSyntxGeneration(generation)) {
    return NextResponse.json({ error: "Syntx job not found" }, { status: 404 });
  }

  const message = (body.error || body.detail || "Syntx worker failed").trim().slice(0, 1000);
  const updated = await db.generation.update({
    where: { id: generationId },
    data: {
      status: "ERROR",
      errorMessage: message,
      resultUrl: null,
      resultMessage: null,
    },
  });

  return NextResponse.json({ ok: true, generation: updated });
}
