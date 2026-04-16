import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_request: Request, context: RouteContext) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const suffix = randomBytes(8).toString("hex");
  const token = `agr_rot_${suffix}`;

  const existing = await db.apiKey.findFirst({
    where: { id, userId: sessionUser.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await db.apiKey.update({
    where: { id },
    data: { token },
  });

  return NextResponse.json({ value: updated.token });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const existing = await db.apiKey.findFirst({
    where: { id, userId: sessionUser.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.apiKey.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
