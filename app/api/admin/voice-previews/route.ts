import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { inferUploadExtAndMime } from "../../../../lib/upload-media-infer";
import {
  supabaseStorageBucket,
  supabaseUploadsEnabled,
  uploadVoicePreviewFile,
} from "../../../../lib/supabase-storage";

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm"]);

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!supabaseUploadsEnabled()) {
    return NextResponse.json(
      { error: "Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY для загрузки превью." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 });
  }

  const voiceId = typeof form.get("voiceId") === "string" ? (form.get("voiceId") as string).trim() : "";
  const file = form.get("file");
  if (!voiceId || !file || typeof file === "string") {
    return NextResponse.json({ error: "Укажите voiceId и файл в поле file" }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Пустой файл или больше 25 МБ" }, { status: 400 });
  }

  const { ext, mime } = inferUploadExtAndMime(file);
  if (!ALLOWED_EXT.has(ext.toLowerCase())) {
    return NextResponse.json(
      { error: "Допустимы только аудио: mp3, wav, m4a, aac, ogg, webm" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const publicUrl = await uploadVoicePreviewFile({
      voiceId,
      buffer,
      mime,
      ext: ext.toLowerCase(),
    });
    await db.voicePreviewOverride.upsert(voiceId, publicUrl);
    return NextResponse.json({ voiceId, previewUrl: publicUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: `Не удалось сохранить превью (${msg}). Проверьте таблицу VoicePreviewOverride и бакет «${supabaseStorageBucket()}».`,
      },
      { status: 503 },
    );
  }
}
