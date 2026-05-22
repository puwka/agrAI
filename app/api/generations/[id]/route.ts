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

  const existing = await db.generation.findFirst({
    where: {
      id: generationId,
      ...(sessionUser.role === "ADMIN" ? {} : { userId: sessionUser.id }),
    },
    select: { id: true, status: true },
  });

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

  await db.generation.delete({ where: { id: generationId } });
  return NextResponse.json({ ok: true });
}
