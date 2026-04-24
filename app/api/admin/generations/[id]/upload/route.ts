import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { db } from "../../../../../../lib/db";
import { getApiSessionUser } from "../../../../../../lib/auth/api-session";
import { inferUploadExtAndMime } from "../../../../../../lib/upload-media-infer";
import {
  supabaseStorageBucket,
  supabaseUploadsEnabled,
  uploadGenerationResultFile,
} from "../../../../../../lib/supabase-storage";

const MAX_BYTES = 80 * 1024 * 1024;

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

  const { ext, mime } = inferUploadExtAndMime(file);

  const buffer = Buffer.from(await file.arrayBuffer());

  let supabaseUploadError: string | null = null;
  if (supabaseUploadsEnabled()) {
    try {
      const publicUrl = await uploadGenerationResultFile({
        generationId,
        buffer,
        mime,
        ext,
      });
      const updated = await db.generation.update({
        where: { id: generationId },
        data: {
          resultUrl: publicUrl,
          resultMessage: null,
          status: "SUCCESS",
          errorMessage: null,
        },
      });
      return NextResponse.json(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      supabaseUploadError = msg;
    }
  }

  try {
    const safeName = `${generationId}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "generations");
    await mkdir(uploadDir, { recursive: true });
    const diskPath = path.join(uploadDir, safeName);
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

    const response = NextResponse.json(updated);
    if (supabaseUploadError) {
      response.headers.set(
        "X-Upload-Warning",
        `Supabase upload failed, saved locally instead: ${supabaseUploadError}`,
      );
    }
    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: supabaseUploadError
          ? `Не удалось загрузить в Supabase (${supabaseUploadError}) и сохранить локально (${msg}).`
          : `Не удалось сохранить файл на сервере (${msg}).`,
      },
      { status: 503 },
    );
  }
}
