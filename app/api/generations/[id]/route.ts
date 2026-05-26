import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

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
    return NextResponse.json({ error: "Не удалось найти генерацию." }, { status: 502 });
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

  try {
    await db.generation.delete({ where: { id: generationId } });
  } catch (error) {
    console.error("[delete-generation]", generationId, error);
    return NextResponse.json({ error: "Не удалось удалить." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
