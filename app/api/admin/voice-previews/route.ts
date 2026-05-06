import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { inferUploadExtAndMime } from "../../../../lib/upload-media-infer";
import { sanitizeStorageVoiceId } from "../../../../lib/supabase-storage";

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm"]);

function extractErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const parts = [obj.message, obj.error, obj.details, obj.detail, obj.hint, obj.code]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
  }
  return String(error);
}

async function saveVoicePreviewLocally(input: { voiceId: string; ext: string; buffer: Buffer }) {
  const safeId = sanitizeStorageVoiceId(input.voiceId);
  const fileName = `${safeId}-${Date.now()}-${randomBytes(4).toString("hex")}${input.ext}`;
  const relDir = path.join("uploads", "voice-previews");
  const absDir = path.join(process.cwd(), "public", relDir);
  await mkdir(absDir, { recursive: true });
  await writeFile(path.join(absDir, fileName), input.buffer);
  return `/api/voice-previews/${fileName}`;
}

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  let publicUrl = "";
  try {
    publicUrl = await saveVoicePreviewLocally({
      voiceId,
      ext: ext.toLowerCase(),
      buffer,
    });
  } catch (e) {
    const msg = extractErrorText(e) || "unknown_error";
    return NextResponse.json(
      {
        error: `Не удалось сохранить превью локально (${msg}).`,
      },
      { status: 503 },
    );
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await db.voicePreviewOverride.upsert(voiceId, publicUrl);
      return NextResponse.json({ voiceId, previewUrl: publicUrl });
    } catch (e) {
      lastError = e;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        continue;
      }
      break;
    }
  }

  const msg = extractErrorText(lastError) || "unknown_error";
  return NextResponse.json(
    {
      error: `Превью загружено, но не удалось сохранить запись в VoicePreviewOverride (${msg}). Проверьте таблицу VoicePreviewOverride.`,
    },
    { status: 503 },
  );
}
