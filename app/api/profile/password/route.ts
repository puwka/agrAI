import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { db } from "../../../../lib/db";

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = (await request.json()) as { currentPassword?: string; newPassword?: string };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Укажите текущий и новый пароль" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Новый пароль должен быть не короче 8 символов" }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "Новый пароль должен отличаться от текущего" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const ok = await compare(currentPassword, String(user.passwordHash ?? ""));
  if (!ok) {
    return NextResponse.json({ error: "Текущий пароль указан неверно" }, { status: 400 });
  }

  const passwordHash = await hash(newPassword, 10);
  await db.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash },
  });

  return NextResponse.json({ ok: true });
}
