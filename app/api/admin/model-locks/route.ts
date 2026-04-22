import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { db } from "../../../../lib/db";

const MAX_MESSAGE = 240;

export async function GET() {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const locks = await db.modelLock.listMap();
  return NextResponse.json({ locks });
}

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { modelId?: unknown; enabled?: unknown; message?: unknown };
  try {
    body = (await request.json()) as { modelId?: unknown; enabled?: unknown; message?: unknown };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const enabled = Boolean(body.enabled);
  const messageRaw = typeof body.message === "string" ? body.message : "";
  const message = messageRaw.trim().slice(0, MAX_MESSAGE);
  if (!modelId) {
    return NextResponse.json({ error: "Укажите modelId" }, { status: 400 });
  }
  if (enabled && !message) {
    return NextResponse.json({ error: "Укажите текст для оверлея" }, { status: 400 });
  }

  try {
    await db.modelLock.setLocked(modelId, enabled, message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Не удалось сохранить (${msg}). Выполните SQL: sql/add_model_lock.sql` },
      { status: 500 },
    );
  }

  const locks = await db.modelLock.listMap();
  return NextResponse.json({ locks });
}
