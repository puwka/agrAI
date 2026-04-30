import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

const ADMIN_GENERATIONS_CACHE_TTL_MS = 8000;
const adminGenerationsCache = new Map<string, { expiresAt: number; payload: unknown }>();

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
  const includeTotal = requestUrl.searchParams.get("includeTotal") === "1";
  const brief = requestUrl.searchParams.get("brief") === "1";
  const fresh = requestUrl.searchParams.get("fresh") === "1";
  const statusRaw = (requestUrl.searchParams.get("status") ?? "").trim().toUpperCase();
  const cacheKey = [statusRaw || "ALL", limitRaw, offsetRaw, brief ? "1" : "0", includeTotal ? "1" : "0"].join("|");
  const now = Date.now();
  const cached = adminGenerationsCache.get(cacheKey);
  if (!fresh && cached && cached.expiresAt > now) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=8" },
    });
  }
  const where =
    statusRaw === "SUCCESS"
      ? { status: "SUCCESS" }
      : statusRaw === "OPEN"
        ? { status: { in: ["PENDING", "QUEUED", "ERROR"] } }
      : statusRaw === "PENDING"
        ? { status: { in: ["PENDING", "QUEUED"] } }
        : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  try {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const items = await db.generation.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
          select: undefined,
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        });
        const total = includeTotal ? await db.generation.countWhere({ where }) : undefined;
        const normalized = brief
          ? (items as Array<{ prompt?: string; resultMessage?: string }>).map((item) => {
              const resultMessage = typeof item.resultMessage === "string" ? item.resultMessage : "";
              return {
                ...item,
                // Промпт не укорачиваем: админу нужен полный текст (раскрыть/свернуть в UI).
                resultMessage: resultMessage.length > 600 ? `${resultMessage.slice(0, 600)}…` : resultMessage,
              };
            })
          : items;
        const payload = {
          items: normalized,
          ...(typeof total === "number" ? { total } : {}),
          limit,
          offset,
          hasMore: items.length === limit,
        };
        adminGenerationsCache.set(cacheKey, {
          expiresAt: now + ADMIN_GENERATIONS_CACHE_TTL_MS,
          payload,
        });
        return NextResponse.json(payload, {
          headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=8" },
        });
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
