import { hash } from "bcryptjs";
import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

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

  let body: { name?: string; email?: string; password?: string; role?: string };
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

  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
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
  });
}
