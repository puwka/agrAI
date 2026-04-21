import { hash } from "bcryptjs";
import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../../../lib/auth/api-session";
import { db } from "../../../../../../lib/db";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const userId = (rawId ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ id" }, { status: 400 });
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json({ error: "РџР°СЂРѕР»СЊ РЅРµ РєРѕСЂРѕС‡Рµ 8 СЃРёРјРІРѕР»РѕРІ" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ" }, { status: 404 });
  }

  const passwordHash = await hash(password, 10);
  await db.user.update({ where: { id: userId }, data: { passwordHash } });

  return NextResponse.json({ ok: true, id: userId });
}