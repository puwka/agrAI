import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { inferUploadExtAndMime } from "../../../../lib/upload-media-infer";
import {
  supabaseStorageBucket,
  supabaseUploadsEnabled,
  uploadVoicePreviewFile,
} from "../../../../lib/supabase-storage";

const VOICE_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
const PREVIEW_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm"]);

function parseTagsJson(body: Record<string, unknown>): string {
  if (Array.isArray(body.voiceStyleTags)) {
    return JSON.stringify(body.voiceStyleTags.map((t) => String(t)));
  }
  if (typeof body.tagsJson === "string") {
    try {
      const p = JSON.parse(body.tagsJson) as unknown;
      if (Array.isArray(p)) return JSON.stringify(p.map((t) => String(t)));
    } catch {
      /* fallthrough */
    }
  }
  if (typeof body.tagsLine === "string" && body.tagsLine.trim()) {
    const parts = body.tagsLine
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return JSON.stringify(parts);
  }
  return "[]";
}

export async function GET() {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const items = await db.customVoice.list();
  return NextResponse.json({ items });
}

async function uploadPreviewAudioIfPresent(voiceId: string, file: unknown): Promise<string | null> {
  if (!file || typeof file === "string" || !(file instanceof File) || file.size <= 0) {
    return null;
  }
  if (file.size > PREVIEW_MAX_BYTES) {
    throw new Error("Файл превью больше 25 МБ");
  }
  if (!supabaseUploadsEnabled()) {
    throw new Error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY для загрузки файла превью.");
  }
  const { ext, mime } = inferUploadExtAndMime(file);
  if (!PREVIEW_EXT.has(ext.toLowerCase())) {
    throw new Error("Превью: допустимы только mp3, wav, m4a, aac, ogg, webm");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadVoicePreviewFile({
    voiceId,
    buffer,
    mime,
    ext: ext.toLowerCase(),
  });
}

export async function POST(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  let voiceId = "";
  let name = "";
  let gender = "";
  let locale = "";
  let previewUrl = "";
  let tagsJson = "[]";
  let previewFile: unknown = null;

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Ожидается multipart/form-data" }, { status: 400 });
    }
    voiceId = typeof form.get("voiceId") === "string" ? (form.get("voiceId") as string).trim() : "";
    name = typeof form.get("name") === "string" ? (form.get("name") as string).trim() : "";
    gender = typeof form.get("gender") === "string" ? (form.get("gender") as string).trim() : "";
    locale = typeof form.get("locale") === "string" ? (form.get("locale") as string).trim() : "";
    previewUrl = typeof form.get("previewUrl") === "string" ? (form.get("previewUrl") as string).trim() : "";
    const tagsLine = typeof form.get("tagsLine") === "string" ? (form.get("tagsLine") as string).trim() : "";
    tagsJson = parseTagsJson({ tagsLine });
    previewFile = form.get("previewFile") ?? form.get("file");
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }
    voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
    name = typeof body.name === "string" ? body.name.trim() : "";
    gender = typeof body.gender === "string" ? body.gender.trim() : "";
    locale = typeof body.locale === "string" ? body.locale.trim() : "";
    previewUrl = typeof body.previewUrl === "string" ? body.previewUrl.trim() : "";
    tagsJson = parseTagsJson(body);
  }

  if (!voiceId || !name) {
    return NextResponse.json({ error: "Укажите voiceId и name" }, { status: 400 });
  }
  if (!VOICE_ID_RE.test(voiceId)) {
    return NextResponse.json(
      { error: "voiceId: только латиница, цифры, _ и -, до 120 символов" },
      { status: 400 },
    );
  }

  try {
    const uploadedUrl = await uploadPreviewAudioIfPresent(voiceId, previewFile);
    const finalPreviewUrl = (uploadedUrl ?? previewUrl).trim();

    const row = await db.customVoice.insert({
      voiceId,
      name,
      gender,
      locale,
      previewUrl: finalPreviewUrl,
      tagsJson,
    });

    if (uploadedUrl) {
      try {
        await db.voicePreviewOverride.upsert(voiceId, uploadedUrl);
      } catch {
        // каталог всё равно возьмёт preview из CustomVoice
      }
    }

    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate|unique|violates/i.test(msg)) {
      return NextResponse.json({ error: "Голос с таким voiceId уже есть" }, { status: 409 });
    }
    if (msg.includes("SUPABASE") || msg.includes("превью") || msg.includes("МБ")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: `Не удалось сохранить (${msg}). Выполните SQL из sql/add_custom_voice.sql в Supabase, проверьте бакет «${supabaseStorageBucket()}».`,
      },
      { status: 503 },
    );
  }
}
