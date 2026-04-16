import { NextResponse } from "next/server";

import { db } from "../../../../../../lib/db";
import { getApiSessionUser } from "../../../../../../lib/auth/api-session";

function clampDays(days: number) {
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.min(365, Math.trunc(days)));
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

  let body: { days?: number; reason?: string | null; clear?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const clear = Boolean(body.clear);
  const days = clampDays(typeof body.days === "number" ? body.days : Number(body.days));
  const reasonRaw = typeof body.reason === "string" ? body.reason : null;
  const reason = reasonRaw?.trim() ? reasonRaw.trim().slice(0, 280) : "Злоупотребление генерациями.";

  const restrictedUntil = clear || days <= 0 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      restrictedUntil,
      restrictedReason: restrictedUntil ? reason : null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      restrictedUntil: true,
      restrictedReason: true,
      createdAt: true,
      _count: { select: { generations: true, apiKeys: true } },
    },
  });

  return NextResponse.json(updated);
}

