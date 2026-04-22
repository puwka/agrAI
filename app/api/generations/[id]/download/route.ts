import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { db } from "../../../../../lib/db";
import { getApiSessionUser } from "../../../../../lib/auth/api-session";
import { mimeFromExtension } from "../../../../../lib/supabase-storage";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads", "generations");

function isPathInsideUploads(absPath: string) {
  const normalized = path.normalize(absPath);
  const root = path.normalize(UPLOADS_ROOT);
  return normalized === root || normalized.startsWith(root + path.sep);
}

function extFromPath(p: string) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(p);
  return m ? m[1].toLowerCase() : "bin";
}

function parseDataUrl(dataUrl: string) {
  const m = /^data:([^;,]+)(;base64)?,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].trim();
  const isBase64 = Boolean(m[2]);
  const payload = m[3];
  if (!isBase64) return null;
  try {
    return { mime, buffer: Buffer.from(payload, "base64") };
  } catch {
    return null;
  }
}

function attachmentFilename(id: string, ext: string) {
  const safe = ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  return `generation-${id}.${safe}`;
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestUrl = new URL(_request.url);
  const inline = requestUrl.searchParams.get("inline") === "1";
  const contentDispositionType = inline ? "inline" : "attachment";
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const generationId = rawId?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  const gen = await db.generation.findFirst({
    where: {
      id: generationId,
      ...(sessionUser.role === "ADMIN" ? {} : { userId: sessionUser.id }),
    },
  });

  if (!gen || gen.status !== "SUCCESS") {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
  }

  const msg = gen.resultMessage?.trim();
  const url = gen.resultUrl?.trim();

  if (!url && msg) {
    const buf = Buffer.from(msg, "utf8");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `${contentDispositionType}; filename="generation-${gen.id}.txt"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (!url) {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
  }

  const resultUrl = url;
  const filename = attachmentFilename(gen.id, extFromPath(resultUrl));

  if (resultUrl.startsWith("data:")) {
    const parsed = parseDataUrl(resultUrl);
    if (!parsed) {
      return NextResponse.json({ error: "Некорректный data URL" }, { status: 400 });
    }
    return new NextResponse(parsed.buffer, {
      status: 200,
      headers: {
        "Content-Type": parsed.mime,
        "Content-Disposition": `${contentDispositionType}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  let pathname = "";
  try {
    if (resultUrl.startsWith("http://") || resultUrl.startsWith("https://")) {
      pathname = new URL(resultUrl).pathname;
    } else if (resultUrl.startsWith("/")) {
      pathname = resultUrl.split("?")[0] ?? "";
    }
  } catch {
    return NextResponse.json({ error: "Некорректный URL" }, { status: 400 });
  }

  if (pathname.startsWith("/uploads/generations/")) {
    const segments = pathname.split("/").filter(Boolean);
    const rel = path.join(...segments);
    const abs = path.join(process.cwd(), "public", rel);
    if (!isPathInsideUploads(abs)) {
      return NextResponse.json({ error: "Недопустимый путь" }, { status: 403 });
    }
    try {
      await fs.access(abs);
    } catch {
      return NextResponse.json({ error: "Файл не найден на сервере" }, { status: 404 });
    }
    const stat = await fs.stat(abs);
    const dotExt = `.${extFromPath(abs)}`;
    const mime = mimeFromExtension(dotExt);
    const rangeHeader = _request.headers.get("range");
    const parsedRange = rangeHeader ? parseRangeHeader(rangeHeader, stat.size) : null;

    if (rangeHeader && !parsedRange) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${stat.size}`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const start = parsedRange?.start ?? 0;
    const end = parsedRange?.end ?? stat.size - 1;
    const chunkSize = end - start + 1;
    const nodeStream = createReadStream(abs, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    return new NextResponse(webStream, {
      status: parsedRange ? 206 : 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(chunkSize),
        "Accept-Ranges": "bytes",
        ...(parsedRange ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
        "Content-Disposition": `${contentDispositionType}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  try {
    const upstreamHeaders: Record<string, string> = {
      Accept: "*/*",
      "User-Agent": "agrAI-download-proxy/1.0",
    };
    const rangeHeader = _request.headers.get("range");
    if (rangeHeader) upstreamHeaders.Range = rangeHeader;
    const upstream = await fetch(resultUrl, {
      redirect: "follow",
      headers: upstreamHeaders,
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "Не удалось получить файл" }, { status: 502 });
    }
    const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    const acceptRanges = upstream.headers.get("accept-ranges");
    const contentRange = upstream.headers.get("content-range");
    const body = upstream.body;
    if (!body) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      return new NextResponse(buf, {
        status: upstream.status === 206 ? 206 : 200,
        headers: {
          "Content-Type": ct,
          ...(contentLength ? { "Content-Length": contentLength } : {}),
          ...(acceptRanges ? { "Accept-Ranges": acceptRanges } : {}),
          ...(contentRange ? { "Content-Range": contentRange } : {}),
          "Content-Disposition": `${contentDispositionType}; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return new NextResponse(body, {
      status: upstream.status === 206 ? 206 : 200,
      headers: {
        "Content-Type": ct,
        ...(contentLength ? { "Content-Length": contentLength } : {}),
        ...(acceptRanges ? { "Accept-Ranges": acceptRanges } : {}),
        ...(contentRange ? { "Content-Range": contentRange } : {}),
        "Content-Disposition": `${contentDispositionType}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Ошибка загрузки внешнего файла" }, { status: 502 });
  }
}
