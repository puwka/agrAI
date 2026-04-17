import { hash } from "bcryptjs";
import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

function clampSubscriptionDays(raw: unknown) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3650, Math.trunc(n)));
}

export async function GET() {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      restrictedUntil: true,
      restrictedReason: true,
      subscriptionUntil: true,
      createdAt: true,
      _count: {
        select: { generations: true, apiKeys: true },
      },
    },
  });

  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; email?: string; password?: string; role?: string; subscriptionDays?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const role = body.role?.trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER";

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Заполните имя, email и пароль" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Пароль не короче 8 символов" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Пользователь с таким email уже есть" }, { status: 409 });
  }

  const passwordHash = await hash(password, 10);

  const subDays = clampSubscriptionDays(body.subscriptionDays);
  const subscriptionUntil =
    role === "ADMIN" || subDays <= 0 ? null : new Date(Date.now() + subDays * 24 * 60 * 60 * 1000);

  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      subscriptionUntil,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      restrictedUntil: true,
      restrictedReason: true,
      subscriptionUntil: true,
      createdAt: true,
      _count: { select: { generations: true, apiKeys: true } },
    },
  });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as "ADMIN" | "USER",
    createdAt: user.createdAt.toISOString(),
    generationsCount: user._count.generations,
    apiKeysCount: user._count.apiKeys,
    restrictedUntil: user.restrictedUntil ? user.restrictedUntil.toISOString() : null,
    restrictedReason: user.restrictedReason,
    subscriptionUntil: user.subscriptionUntil ? user.subscriptionUntil.toISOString() : null,
  });
}
