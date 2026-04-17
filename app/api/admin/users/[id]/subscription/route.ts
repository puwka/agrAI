import { NextResponse } from "next/server";

import { db } from "../../../../../../lib/db";
import { getApiSessionUser } from "../../../../../../lib/auth/api-session";

function clampDays(days: number) {
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.min(3650, Math.trunc(days)));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const userId = id?.trim();
  if (!userId) {
    return NextResponse.json({ error: "Некорректный user id" }, { status: 400 });
  }

  let body: { days?: number; clear?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const clear = Boolean(body.clear);
  const days = clampDays(typeof body.days === "number" ? body.days : Number(body.days));

  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { subscriptionUntil: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  let subscriptionUntil: Date | null = null;

  if (clear) {
    subscriptionUntil = null;
  } else if (days <= 0) {
    return NextResponse.json({ error: "Укажите количество дней больше 0 или clear: true" }, { status: 400 });
  } else {
    const now = Date.now();
    const current = existing.subscriptionUntil;
    const base =
      current && current.getTime() > now ? current.getTime() : now;
    subscriptionUntil = new Date(base + days * 24 * 60 * 60 * 1000);
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: { subscriptionUntil },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      subscriptionUntil: true,
      restrictedUntil: true,
      restrictedReason: true,
      createdAt: true,
      _count: { select: { generations: true, apiKeys: true } },
    },
  });

  return NextResponse.json(updated);
}
