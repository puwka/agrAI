import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getApiSessionUser } from "../../../lib/auth/api-session";

export async function GET() {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      company: true,
      telegram: true,
      notificationsEnabled: true,
      weeklyReportEnabled: true,
      defaultAspectRatio: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const data: {
    name?: string;
    company?: string | null;
    telegram?: string | null;
    notificationsEnabled?: boolean;
    weeklyReportEnabled?: boolean;
    defaultAspectRatio?: string;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (body.company === null || typeof body.company === "string") {
    data.company = body.company?.trim() || null;
  }
  if (body.telegram === null || typeof body.telegram === "string") {
    data.telegram = body.telegram?.trim() || null;
  }
  if (typeof body.notificationsEnabled === "boolean") {
    data.notificationsEnabled = body.notificationsEnabled;
  }
  if (typeof body.weeklyReportEnabled === "boolean") {
    data.weeklyReportEnabled = body.weeklyReportEnabled;
  }
  if (typeof body.defaultAspectRatio === "string" && ["9:16", "16:9"].includes(body.defaultAspectRatio)) {
    data.defaultAspectRatio = body.defaultAspectRatio;
  }

  const updated = await db.user.update({
    where: { id: sessionUser.id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      company: true,
      telegram: true,
      notificationsEnabled: true,
      weeklyReportEnabled: true,
      defaultAspectRatio: true,
    },
  });

  return NextResponse.json(updated);
}
