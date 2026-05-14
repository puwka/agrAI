import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | undefined;
const SUPABASE_FETCH_TIMEOUT_MS = 30000;
const SUPABASE_FETCH_WRITE_TIMEOUT_MS = 45000;
const SUPABASE_FETCH_RETRIES = 4;
let ensuredBucketName: string | null = null;

function isTransientNetworkError(error: unknown) {
  const msg = String(
    (error as { message?: unknown })?.message ??
      (error as { details?: unknown })?.details ??
      error ??
      "",
  ).toLowerCase();
  return (
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("terminated") ||
    msg.includes("fetch failed") ||
    msg.includes("aborted") ||
    msg.includes("socket hang up") ||
    msg.includes("supabase_timeout")
  );
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const parts = [obj.error, obj.message, obj.details, obj.detail, obj.hint, obj.code]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
  }
  return String(error).trim();
}

async function supabaseFetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  const method = String(init?.method ?? "GET").toUpperCase();
  const timeoutMs =
    method === "GET" || method === "HEAD" ? SUPABASE_FETCH_TIMEOUT_MS : SUPABASE_FETCH_WRITE_TIMEOUT_MS;
  for (let attempt = 1; attempt <= SUPABASE_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("SUPABASE_TIMEOUT")), timeoutMs);
    try {
      const response = await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < SUPABASE_FETCH_RETRIES && isTransientNetworkError(error)) {
        const jitter = Math.floor(Math.random() * 200);
        await delay(350 * 2 ** (attempt - 1) + jitter);
        continue;
      }
      break;
    }
  }
  const detail = extractErrorText(lastError) || "Supabase fetch failed";
  throw new Error(`SUPABASE_FETCH_ERROR: ${detail}`);
}

function getAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL?.trim() ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
    if (!url || !key) {
      throw new Error("SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY должны быть заданы для загрузки в Storage");
    }
    admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetchWithRetry },
    });
  }
  return admin;
}

async function ensureBucketExists() {
  const bucket = supabaseStorageBucket();
  if (ensuredBucketName === bucket) return;
  const supabase = getAdmin();
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (!error && data) {
    ensuredBucketName = bucket;
    return;
  }
  const missing =
    error &&
    /not found|does not exist|bucket.*not/i.test(
      `${(error as { message?: string })?.message ?? ""} ${(error as { error?: string })?.error ?? ""}`,
    );
  if (!missing) return;
  const { error: createError } = await supabase.storage.createBucket(bucket, { public: true });
  if (createError) {
    throw new Error(createError.message);
  }
  ensuredBucketName = bucket;
}

export function supabaseUploadsEnabled() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/** Где хранить файлы результатов генераций (Syntx complete и т.п.). */
export function generationResultsUseSupabaseStorage(): boolean {
  const raw = process.env.GENERATION_RESULTS_STORAGE?.trim().toLowerCase() ?? "";
  if (raw === "local" || raw === "filesystem" || raw === "disk") {
    return false;
  }
  if (raw === "supabase" || raw === "storage" || raw === "remote") {
    return true;
  }
  // По умолчанию — диск на сервере приложения (local-generation:), без Supabase Storage.
  return false;
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
  await ensureBucketExists();
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

/** Загрузка больших файлов без буфера целиком в RAM (Node Readable). */
export async function uploadUserReferenceImageStream(input: {
  userId: string;
  stream: Readable;
  mime: string;
  ext: string;
}) {
  const bucket = supabaseStorageBucket();
  await ensureBucketExists();
  const safeBase = `${input.userId}-${Date.now()}-${randomBytes(6).toString("hex")}${input.ext}`;
  const objectPath = `references/${safeBase}`;
  const supabase = getAdmin();
  const { error } = await supabase.storage.from(bucket).upload(objectPath, input.stream, {
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
  await ensureBucketExists();
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

/** Полный текст для озвучки (> лимита в БД): хранится в Storage, в Generation.prompt — только маркер. */
export async function uploadGenerationResultFile(input: {
  generationId: string;
  buffer: Buffer;
  mime: string;
  ext: string;
}) {
  const bucket = supabaseStorageBucket();
  await ensureBucketExists();
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
