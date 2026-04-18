import { mimeFromExtension } from "./supabase-storage";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/webm": ".webm",
};

function extFromMime(mime: string) {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXT[base] ?? "";
}

function extFromFilename(name: string) {
  const lower = name.trim().toLowerCase();
  const m = /\.([a-z0-9]{1,8})$/.exec(lower);
  return m ? `.${m[1]}` : "";
}

/** Расширение и MIME для загрузки результата / превью (браузер часто шлёт пустой type). */
export function inferUploadExtAndMime(file: File): { ext: string; mime: string } {
  const rawMime = file.type?.trim() ?? "";
  let ext = extFromMime(rawMime);
  if (!ext) {
    ext = extFromFilename(file.name);
  }
  if (!ext || ext === ".") {
    ext = ".bin";
  }
  const mime =
    rawMime && rawMime !== "application/octet-stream" ? rawMime : mimeFromExtension(ext);
  return { ext, mime };
}
