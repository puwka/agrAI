import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { db } from "../../../../../lib/db";
import { getApiSessionUser } from "../../../../../lib/auth/api-session";
import {
  localGenerationResultPath,
  parseLocalGenerationResultUrl,
} from "../../../../../lib/local-generation-result";
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

function extFromContentType(contentType: string): string | null {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("audio/mpeg") || ct.includes("audio/mp3")) return "mp3";
  if (ct.includes("audio/wav") || ct.includes("audio/x-wav")) return "wav";
  if (ct.includes("audio/ogg")) return "ogg";
  if (ct.includes("audio/mp4") || ct.includes("audio/aac")) return "m4a";
  if (ct.includes("audio/flac")) return "flac";
  if (ct.includes("audio/webm")) return "webm";
  if (ct.includes("video/mp4")) return "mp4";
  if (ct.includes("video/webm")) return "webm";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/jpeg")) return "jpg";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("image/gif")) return "gif";
  return null;
}

function isTransientNetworkError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("terminated") ||
    msg.includes("fetch failed") ||
    msg.includes("aborted")
  );
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  if (!url && msg) {
    const buf = Buffer.from(msg, "utf8");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": inline
          ? `inline; filename="generation-${gen.id}.txt"`
          : `attachment; filename="generation-${gen.id}.txt"`,
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
        "Content-Disposition": inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const localFileName = parseLocalGenerationResultUrl(resultUrl);
  if (localFileName) {
    const abs = localGenerationResultPath(localFileName);
    try {
      await fs.access(abs);
    } catch {
      return NextResponse.json({ error: "Файл не найден на сервере" }, { status: 404 });
    }
    const stat = await fs.stat(abs);
    const nodeStream = createReadStream(abs);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const dotExt = `.${extFromPath(abs)}`;
    const mime = mimeFromExtension(dotExt);

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  let pathname = "";
  let isExternalHttpUrl = false;
  try {
    if (resultUrl.startsWith("http://") || resultUrl.startsWith("https://")) {
      isExternalHttpUrl = true;
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
    const nodeStream = createReadStream(abs);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const dotExt = `.${extFromPath(abs)}`;
    const mime = mimeFromExtension(dotExt);

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (isExternalHttpUrl) {
    // Для внешних URL не проксируем тело и не навязываем расширение/attachment.
    // Иначе HTML-страницы и CDN-ссылки без расширения часто скачиваются как .bin.
    return NextResponse.redirect(resultUrl, 302);
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const upstream = await fetch(resultUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      if (!upstream.ok) {
        return NextResponse.json({ error: "Не удалось получить файл" }, { status: 502 });
      }
      const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
      const extByPath = extFromPath(resultUrl);
      const extByCt = extFromContentType(ct);
      const resolvedExt =
        extByPath !== "bin"
          ? extByPath
          : extByCt
            ? extByCt
            : gen.modelId === "voice"
              ? "mp3"
              : "bin";
      const contentTypeResolved =
        ct === "application/octet-stream" && gen.modelId === "voice" ? "audio/mpeg" : ct;
      const remoteFilename = attachmentFilename(gen.id, resolvedExt);
      // Read the remote body fully before responding to avoid "failed to pipe response"
      // when upstream closes the stream with ETIMEDOUT/terminated mid-transfer.
      const buf = Buffer.from(await upstream.arrayBuffer());
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": contentTypeResolved,
          "Content-Length": String(buf.byteLength),
          "Content-Disposition": inline
            ? `inline; filename="${remoteFilename}"`
            : `attachment; filename="${remoteFilename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    } catch (e) {
      lastError = e;
      if (attempt < 2 && isTransientNetworkError(e)) {
        await delay(250);
        continue;
      }
      break;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "");
  return NextResponse.json(
    { error: "Ошибка загрузки внешнего файла", detail },
    { status: 502 },
  );
}
