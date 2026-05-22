import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

/** Прямой DELETE через PostgREST — 10 сек таймаут, без retry-обёртки. */
async function directDeleteGeneration(generationId: string): Promise<{ ok: boolean; error?: string }> {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/Generation?id=eq.${encodeURIComponent(generationId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        signal: controller.signal,
      },
    );
    if (!resp.ok) {
      const text = (await resp.text().catch(() => "")).slice(0, 300);
      return { ok: false, error: `Supabase ${resp.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const generationId = rawId?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  let existing: { id?: string; status?: string; userId?: string } | null = null;
  try {
    existing = await db.generation.findFirst({
      where: {
        id: generationId,
        ...(sessionUser.role === "ADMIN" ? {} : { userId: sessionUser.id }),
      },
      select: { id: true, status: true },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось найти генерацию (таймаут БД)." }, { status: 502 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Генерация не найдена" }, { status: 404 });
  }

  const status = String(existing.status ?? "");
  if (status !== "SUCCESS" && status !== "ERROR") {
    return NextResponse.json(
      { error: "Удалить можно только завершённые генерации (готовые или с ошибкой)." },
      { status: 409 },
    );
  }

  const result = await directDeleteGeneration(generationId);
  if (!result.ok) {
    console.error("[delete-generation]", generationId, result.error);
    return NextResponse.json({ error: "Не удалось удалить." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
