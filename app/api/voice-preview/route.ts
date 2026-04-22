import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../lib/auth/api-session";

const FETCH_TIMEOUT_MS = 12_000;

function isAllowedPreviewHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "secretvoicer.com" ||
    host.endsWith(".secretvoicer.com") ||
    host === "supabase.co" ||
    host.endsWith(".supabase.co")
  );
}

export async function GET(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reqUrl = new URL(request.url);
  const raw = (reqUrl.searchParams.get("u") ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Укажите параметр u" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Некорректный URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return NextResponse.json({ error: "Недопустимый протокол" }, { status: 400 });
  }
  if (!isAllowedPreviewHost(target.hostname)) {
    return NextResponse.json({ error: "Недопустимый источник preview" }, { status: 403 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstreamHeaders: Record<string, string> = {
      Accept: "audio/*,*/*;q=0.8",
      "User-Agent": "agrAI-voice-preview-proxy/1.0",
    };
    const range = request.headers.get("range");
    if (range) {
      upstreamHeaders.Range = range;
    }
    const upstream = await fetch(target.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: upstreamHeaders,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: "Не удалось получить превью" }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const contentLength = upstream.headers.get("content-length");
    const acceptRanges = upstream.headers.get("accept-ranges");
    const contentRange = upstream.headers.get("content-range");
    const cacheControl = upstream.headers.get("cache-control") || "public, max-age=3600";

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    if (contentLength) headers.set("Content-Length", contentLength);
    if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
    if (contentRange) headers.set("Content-Range", contentRange);

    // Буферизуем ответ: это убирает server error "failed to pipe response"
    // при сетевом обрыве/таймауте в процессе стрима.
    const body = Buffer.from(await upstream.arrayBuffer());
    headers.set("Content-Length", String(body.byteLength));
    return new NextResponse(body, { status: upstream.status === 206 ? 206 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Ошибка проксирования превью" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
