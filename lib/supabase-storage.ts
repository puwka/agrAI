import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | undefined;

function getAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL?.trim() ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
    if (!url || !key) {
      throw new Error("SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY должны быть заданы для загрузки в Storage");
    }
    admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return admin;
}

export function supabaseUploadsEnabled() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function supabaseStorageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "agrai-uploads";
}

/** Публичный URL вида …/storage/v1/object/public/{bucket}/{path} */
export function parseSupabasePublicObjectUrl(
  href: string,
): { bucket: string; objectPath: string } | null {
  try {
    const u = new URL(href);
    const pathname = u.pathname;
    const marker = "/storage/v1/object/public/";
    const idx = pathname.indexOf(marker);
    if (idx === -1) return null;
    const rest = pathname.slice(idx + marker.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    const bucket = rest.slice(0, slash);
    const objectPath = decodeURIComponent(rest.slice(slash + 1));
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  } catch {
    return null;
  }
}

export function isOurSupabaseStoragePublicUrl(href: string) {
  const parsed = parseSupabasePublicObjectUrl(href);
  return Boolean(parsed && parsed.bucket === supabaseStorageBucket());
}

export function isValidSupabaseReferencePublicUrl(href: string, userId: string) {
  const parsed = parseSupabasePublicObjectUrl(href);
  if (!parsed || parsed.bucket !== supabaseStorageBucket()) return false;
  if (!parsed.objectPath.startsWith("references/")) return false;
  if (parsed.objectPath.includes("..")) return false;
  const segments = parsed.objectPath.split("/").filter(Boolean);
  const file = segments[segments.length - 1] ?? "";
  if (!file.startsWith(`${userId}-`)) return false;
  return /^[a-zA-Z0-9._-]+$/.test(file);
}

export async function uploadUserReferenceImage(input: {
  userId: string;
  buffer: Buffer;
  mime: string;
  ext: string;
}) {
  const bucket = supabaseStorageBucket();
  const safeBase = `${input.userId}-${Date.now()}-${randomBytes(6).toString("hex")}${input.ext}`;
  const objectPath = `references/${safeBase}`;
  const supabase = getAdmin();
  const { error } = await supabase.storage.from(bucket).upload(objectPath, input.buffer, {
    contentType: input.mime,
    upsert: false,
  });
  if (error) {
    throw new Error(error.message);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

export function mimeFromExtension(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".mp3") return "audio/mpeg";
  if (e === ".wav") return "audio/wav";
  if (e === ".ogg") return "audio/ogg";
  if (e === ".m4a" || e === ".aac") return "audio/mp4";
  if (e === ".flac") return "audio/flac";
  if (e === ".webm") return "audio/webm";
  if (e === ".mp4") return "video/mp4";
  if (e === ".mov") return "video/quicktime";
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  return "application/octet-stream";
}

export function sanitizeStorageVoiceId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) || "voice";
}

export async function uploadVoicePreviewFile(input: {
  voiceId: string;
  buffer: Buffer;
  mime: string;
  ext: string;
}) {
  const bucket = supabaseStorageBucket();
  const safeId = sanitizeStorageVoiceId(input.voiceId);
  const objectPath = `voice-previews/${safeId}${input.ext}`;
  const supabase = getAdmin();
  const rawMime = input.mime?.trim() || "";
  const contentType =
    rawMime && rawMime !== "application/octet-stream" ? rawMime : mimeFromExtension(input.ext);
  const { error } = await supabase.storage.from(bucket).upload(objectPath, input.buffer, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(error.message);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function uploadGenerationResultFile(input: {
  generationId: string;
  buffer: Buffer;
  mime: string;
  ext: string;
}) {
  const bucket = supabaseStorageBucket();
  const objectPath = `generations/${input.generationId}${input.ext}`;
  const supabase = getAdmin();
  const rawMime = input.mime?.trim() || "";
  const contentType =
    rawMime && rawMime !== "application/octet-stream" ? rawMime : mimeFromExtension(input.ext);
  const { error } = await supabase.storage.from(bucket).upload(objectPath, input.buffer, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(error.message);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function deleteStorageObjectByPublicUrl(href: string | null | undefined) {
  const raw = href?.trim();
  if (!raw) return;
  const parsed = parseSupabasePublicObjectUrl(raw);
  if (!parsed || parsed.bucket !== supabaseStorageBucket()) return;
  try {
    const supabase = getAdmin();
    await supabase.storage.from(parsed.bucket).remove([parsed.objectPath]);
  } catch {
    // ignore
  }
}
