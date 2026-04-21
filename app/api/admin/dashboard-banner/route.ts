import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { db } from "../../../../lib/db";

const DEFAULT_MESSAGE = "";
const MAX_MESSAGE = 4000;

export async function GET() {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await db.dashboardBanner.getGlobal();
  return NextResponse.json({
    enabled: Boolean(row?.enabled),
    message: row?.message || DEFAULT_MESSAGE,
  });
}

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { enabled?: unknown; message?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown; message?: unknown };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Укажите enabled (boolean)" }, { status: 400 });
  }

  const messageRaw = typeof body.message === "string" ? body.message : "";
  const message = messageRaw.trim().slice(0, MAX_MESSAGE);

  await db.dashboardBanner.upsertGlobal({ enabled: body.enabled, message });

  const row = await db.dashboardBanner.getGlobal();
  return NextResponse.json({
    enabled: Boolean(row?.enabled),
    message: row?.message || DEFAULT_MESSAGE,
  });
}
