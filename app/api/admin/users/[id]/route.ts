import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../../lib/auth/api-session";
import { db } from "../../../../../lib/db";

type Ctx = {
  params: Promise<{ id?: string }>;
};

export async function DELETE(_request: Request, context: Ctx) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const userId = String(params?.id ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "Не указан userId" }, { status: 400 });
  }

  if (userId === sessionUser.id) {
    return NextResponse.json({ error: "Нельзя удалить свой аккаунт" }, { status: 400 });
  }

  const exists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  await db.apiKey.deleteManyByUserId(userId);
  await db.generation.deleteManyByUserId(userId);
  await db.user.delete({ where: { id: userId } });

  return NextResponse.json({ ok: true, id: userId });
}
