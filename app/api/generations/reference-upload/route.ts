import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { db } from "../../../../lib/db";
import { hasActiveSubscription } from "../../../../lib/subscription";
import {
  supabaseStorageBucket,
  supabaseUploadsEnabled,
  uploadUserReferenceImage,
} from "../../../../lib/supabase-storage";

const MAX_BYTES = 20 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function extFromMime(mime: string) {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXT[base] ?? "";
}

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
    return NextResponse.json({ error: "Добавьте изображение в поле file" }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "Пустой файл" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 20 МБ)" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  const ext = extFromMime(mime);
  if (!ext) {
    return NextResponse.json(
      { error: "Допустимы только изображения: PNG, JPEG, WebP, GIF" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (supabaseUploadsEnabled()) {
    try {
      const publicUrl = await uploadUserReferenceImage({
        userId: sessionUser.id,
        buffer,
        mime,
        ext,
      });
      return NextResponse.json({ url: publicUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: `Не удалось загрузить файл в Supabase Storage (${msg}). Создайте публичный бакет «${supabaseStorageBucket()}» (Storage → New bucket) и задайте SUPABASE_STORAGE_BUCKET при другом имени.`,
        },
        { status: 503 },
      );
    }
  }

  const safeBase = `${sessionUser.id}-${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "generations", "references");
  await mkdir(uploadDir, { recursive: true });

  const diskPath = path.join(uploadDir, safeBase);
  await writeFile(diskPath, buffer);

  const publicPath = `/uploads/generations/references/${safeBase}`;
  return NextResponse.json({ url: publicPath });
}
