import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../lib/auth/api-session";

const FETCH_TIMEOUT_MS = 12_000;

function isAllowedPreviewHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "secretvoicer.com" ||
    host.endsWith(".secretvoicer.com") ||
    host === "storage.googleapis.com" ||
    host.endsWith(".googleapis.com") ||
    host === "cdn.elevenlabs.io" ||
    host.endsWith(".elevenlabs.io") ||
    host === "supabase.co" ||
    host.endsWith(".supabase.co")
  );
}

function parseRangeHeader(rangeHeader: string, size: number) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  let start = startRaw ? Number(startRaw) : NaN;
  let end = endRaw ? Number(endRaw) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    const suffixLen = Number(endRaw);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    start = Math.max(0, size - suffixLen);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < 0 || start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

function looksLikeMp3(buf: Buffer) {
  if (buf.length < 4) return false;
  // ID3
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // MPEG frame sync
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
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
      Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://secretvoicer.com/",
      Origin: "https://secretvoicer.com",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    };
    const requestedRange = request.headers.get("range");
    if (requestedRange) {
      upstreamHeaders.Range = requestedRange;
    }
    const upstream = await fetch(target.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: upstreamHeaders,
    });

    if (!upstream.ok && upstream.status !== 206) {
      // У части ссылок SecretVoicer проксирование может падать, но прямой запрос из браузера
      // иногда проходит. В этом случае возвращаем редирект на исходный URL.
      if (target.hostname.toLowerCase().endsWith("secretvoicer.com")) {
        return NextResponse.redirect(target.toString(), 302);
      }
      return NextResponse.json({ error: "Не удалось получить превью" }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const contentTypeLower = contentType.toLowerCase();
    const cacheControl = upstream.headers.get("cache-control") || "public, max-age=3600";

    // Буферизуем ответ: это убирает server error "failed to pipe response"
    // при сетевом обрыве/таймауте в процессе стрима.
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.byteLength <= 0) {
      return NextResponse.json({ error: "Пустой ответ preview" }, { status: 502 });
    }
    const hasMp3Ext = /\.mp3(\?|$)/i.test(target.toString());
    const mp3ByBytes = looksLikeMp3(body);
    const isAudioType = contentTypeLower.startsWith("audio/");
    if (!isAudioType && !(hasMp3Ext && mp3ByBytes)) {
      if (target.hostname.toLowerCase().endsWith("secretvoicer.com")) {
        return NextResponse.redirect(target.toString(), 302);
      }
      return NextResponse.json({ error: "Источник вернул не аудио" }, { status: 502 });
    }

    const effectiveMime = isAudioType
      ? contentType
      : hasMp3Ext || mp3ByBytes
        ? "audio/mpeg"
        : "application/octet-stream";

    const headers = new Headers({
      "Content-Type": effectiveMime,
      "Cache-Control": cacheControl,
      "Accept-Ranges": "bytes",
    });
    const parsedRange = requestedRange ? parseRangeHeader(requestedRange, body.byteLength) : null;
    if (requestedRange && !parsedRange) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${body.byteLength}`,
          "Cache-Control": cacheControl,
        },
      });
    }
    if (parsedRange) {
      const chunk = body.subarray(parsedRange.start, parsedRange.end + 1);
      headers.set("Content-Length", String(chunk.byteLength));
      headers.set("Content-Range", `bytes ${parsedRange.start}-${parsedRange.end}/${body.byteLength}`);
      return new NextResponse(chunk, { status: 206, headers });
    }
    headers.set("Content-Length", String(body.byteLength));
    return new NextResponse(body, { status: 200, headers });
  } catch {
    if (target.hostname.toLowerCase().endsWith("secretvoicer.com")) {
      // Фолбэк на прямую загрузку; дополнительно пробуем http-вариант.
      const direct = target.toString();
      const alt =
        target.protocol === "https:"
          ? direct.replace(/^https:\/\//i, "http://")
          : direct.replace(/^http:\/\//i, "https://");
      return NextResponse.redirect(alt || direct, 302);
    }
    return NextResponse.json({ error: "Ошибка проксирования превью" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
