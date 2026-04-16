import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { db } from "../../../../../../lib/db";
import { getApiSessionUser } from "../../../../../../lib/auth/api-session";

const MAX_BYTES = 80 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

function extFromMime(mime: string) {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXT[base] ?? "";
}

function extFromName(name: string) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  if (!m) return "";
  return `.${m[1].toLowerCase()}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const generationId = rawId?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  const existing = await db.generation.findUnique({
    where: { id: generationId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Генерация не найдена" }, { status: 404 });
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

  if (file.size <= 0) {
    return NextResponse.json({ error: "Пустой файл" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 80 МБ)" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  let ext = extFromMime(mime);
  if (!ext) {
    ext = extFromName(file.name) || ".bin";
  }

  const safeName = `${generationId}${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "generations");
  await mkdir(uploadDir, { recursive: true });

  const diskPath = path.join(uploadDir, safeName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(diskPath, buffer);

  const publicPath = `/uploads/generations/${safeName}`;

  const updated = await db.generation.update({
    where: { id: generationId },
    data: {
      resultUrl: publicPath,
      resultMessage: null,
      status: "SUCCESS",
      errorMessage: null,
    },
  });

  return NextResponse.json(updated);
}
