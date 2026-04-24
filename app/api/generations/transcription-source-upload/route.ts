import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { db } from "../../../../lib/db";
import { hasActiveSubscription } from "../../../../lib/subscription";
import { inferUploadExtAndMime } from "../../../../lib/upload-media-infer";
import { MAX_TRANSCRIPTION_UPLOAD_BYTES } from "../../../../lib/transcription-limits";

const ALLOWED_EXT = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".flac",
  ".opus",
  ".mpeg",
  ".mpg",
]);

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (sessionUser.role !== "ADMIN") {
    const u = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: { restrictedUntil: true, restrictedReason: true, subscriptionUntil: true },
    });
    const now = Date.now();
    if (u?.restrictedUntil && u.restrictedUntil.getTime() > now) {
      return NextResponse.json(
        { error: u.restrictedReason?.trim() || "Доступ ограничен." },
        { status: 403 },
      );
    }
    if (!hasActiveSubscription(sessionUser.role, u?.subscriptionUntil ?? null)) {
      return NextResponse.json({ error: "Подписка закончилась." }, { status: 403 });
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Добавьте файл в поле file" }, { status: 400 });
  }

  const size = typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0;
  if (size <= 0) {
    return NextResponse.json({ error: "Пустой файл" }, { status: 400 });
  }

  if (size > MAX_TRANSCRIPTION_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 3 ГБ)" }, { status: 400 });
  }

  const { ext, mime } = inferUploadExtAndMime(file);
  const extLower = ext.toLowerCase();
  if (!ALLOWED_EXT.has(extLower)) {
    return NextResponse.json(
      { error: "Допустимы только видео и аудио: MP4, WebM, MOV, MP3, WAV, OGG, M4A, AAC, FLAC и др." },
      { status: 400 },
    );
  }

  const webStream = file.stream();
  const nodeIn = Readable.fromWeb(webStream as import("stream/web").ReadableStream<Uint8Array>);

  const safeBase = `${sessionUser.id}-${Date.now()}-${randomBytes(6).toString("hex")}${extLower}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "generations", "references");
  await mkdir(uploadDir, { recursive: true });

  const diskPath = path.join(uploadDir, safeBase);
  try {
    await pipeline(nodeIn, createWriteStream(diskPath));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await unlink(diskPath).catch(() => {});
    return NextResponse.json({ error: `Не удалось сохранить файл (${msg})` }, { status: 500 });
  }

  const publicPath = `/api/generations/reference-file/${safeBase}`;
  return NextResponse.json({ url: publicPath });
}
