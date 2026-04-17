import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getApiSessionUser } from "../../../lib/auth/api-session";

function formatUsage(usage: number, quota: number) {
  if (quota >= 1000) {
    return `${(usage / 1000).toFixed(1)}k / month`;
  }
  return `${usage} / month`;
}

function formatLastUsed(date: Date | null) {
  if (!date) {
    return "—";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export async function GET() {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await db.apiKey.findMany({
    where: { userId: sessionUser.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    keys.map((key: any) => ({
      id: key.id,
      name: key.name,
      value: key.token,
      status: key.status === "LIMITED" ? "limited" : "active",
      scope: key.scope,
      requests: formatUsage(key.usageCount, key.monthlyQuota),
      lastUsed: formatLastUsed(key.lastUsedAt),
    })),
  );
}

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; scope?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const name = body.name?.trim() || "New API Key";
  const scope = body.scope?.trim() || "generations:create, generations:read";
  const suffix = randomBytes(6).toString("hex");
  const token = `agr_live_${suffix}`;

  const created = await db.apiKey.create({
    data: {
      userId: sessionUser.id,
      name,
      token,
      status: "ACTIVE",
      scope,
      monthlyQuota: 25000,
      usageCount: 0,
    },
  });

  return NextResponse.json({
    id: created.id,
    name: created.name,
    value: created.token,
    status: "active",
    scope: created.scope,
    requests: formatUsage(created.usageCount, created.monthlyQuota),
    lastUsed: formatLastUsed(created.lastUsedAt),
  });
}
