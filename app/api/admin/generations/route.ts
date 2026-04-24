import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

function isTransientNetworkError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return msg.includes("ECONNRESET") || msg.includes("terminated") || msg.includes("fetch failed");
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const DEFAULT_LIMIT = 60;
  const MAX_LIMIT = 120;
  const requestUrl = new URL(request.url);
  const limitRaw = Number(requestUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const offsetRaw = Number(requestUrl.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  try {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const [items, total] = await Promise.all([
          db.generation.findMany({
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          }),
          db.generation.countWhere(),
        ]);
        return NextResponse.json({ items, total, limit, offset });
      } catch (e) {
        lastError = e;
        if (attempt < 2 && isTransientNetworkError(e)) {
          await delay(250);
          continue;
        }
        throw e;
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "");
    return NextResponse.json({ error: "Не удалось загрузить генерации", detail }, { status: 503 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return NextResponse.json({ error: "Не удалось загрузить генерации", detail }, { status: 503 });
  }
}
