import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCAL_RESULT_PREFIX = "local-generation:";
const LOCAL_UPLOADS_ROOT = path.join(process.cwd(), ".runtime", "uploads", "generations");

export function localGenerationUploadsRoot() {
  return LOCAL_UPLOADS_ROOT;
}

export function localGenerationResultUrl(fileName: string) {
  return `${LOCAL_RESULT_PREFIX}${fileName}`;
}

export function parseLocalGenerationResultUrl(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw.startsWith(LOCAL_RESULT_PREFIX)) return null;
  const fileName = raw.slice(LOCAL_RESULT_PREFIX.length).trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName) || fileName.includes("..")) return null;
  return fileName;
}

export function localGenerationResultPath(fileName: string) {
  return path.join(localGenerationUploadsRoot(), fileName);
}

export async function saveLocalGenerationResultFile(input: {
  generationId: string;
  ext: string;
  buffer: Buffer;
}) {
  const safeExt = input.ext.startsWith(".") ? input.ext : `.${input.ext}`;
  const fileName = `${input.generationId}${safeExt.replace(/[^a-zA-Z0-9.]/g, "") || ".bin"}`;
  const uploadDir = localGenerationUploadsRoot();
  await mkdir(uploadDir, { recursive: true });
  await writeFile(localGenerationResultPath(fileName), input.buffer);
  return localGenerationResultUrl(fileName);
}

export async function deleteLocalGenerationResultFile(value: string | null | undefined, generationId: string) {
  const fileName = parseLocalGenerationResultUrl(value);
  if (!fileName || !fileName.startsWith(generationId)) return;
  try {
    await unlink(localGenerationResultPath(fileName));
  } catch {
    // Ignore missing runtime files.
  }
}
