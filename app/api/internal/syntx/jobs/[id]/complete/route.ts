import { NextResponse } from "next/server";

import { db } from "../../../../../../../lib/db";
import { requireAutomationWorker, isSyntxGeneration } from "../../../../../../../lib/automation-worker";
import { saveLocalGenerationResultFile } from "../../../../../../../lib/local-generation-result";
import { inferUploadExtAndMime } from "../../../../../../../lib/upload-media-infer";
import {
  generationResultsUseSupabaseStorage,
  uploadGenerationResultFile,
} from "../../../../../../../lib/supabase-storage";

const MAX_RESULT_BYTES = 500 * 1024 * 1024;

function isTransientSupabaseMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("supabase_fetch") ||
    m.includes("supabase_timeout") ||
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("etimedout")
  );
}

async function withTransientDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const attempts = Math.max(1, Math.min(8, Number.parseInt(process.env.SYNTX_COMPLETE_DB_RETRIES ?? "5", 10) || 5));
  let last: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (i < attempts && isTransientSupabaseMessage(msg)) {
        console.warn(`[syntx/complete] ${label} retry ${i}/${attempts}:`, msg);
        await new Promise((r) => setTimeout(r, 450 * i));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function saveResultFile(generationId: string, file: File) {
  const { ext, mime } = inferUploadExtAndMime(file);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (generationResultsUseSupabaseStorage()) {
    return uploadGenerationResultFile({
      generationId,
      buffer,
      mime,
      ext,
    });
  }

  return saveLocalGenerationResultFile({ generationId, ext, buffer });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const forbidden = requireAutomationWorker(request);
  if (forbidden) return forbidden;

  const { id: rawId } = await context.params;
  const generationId = rawId?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  const generation = await withTransientDbRetry("findUnique", () =>
    db.generation.findUnique({ where: { id: generationId } }),
  );
  if (!generation || !isSyntxGeneration(generation)) {
    return NextResponse.json({ error: "Syntx job not found" }, { status: 404 });
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
  if (file.size > MAX_RESULT_BYTES) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 500 МБ)" }, { status: 400 });
  }

  try {
    const resultUrl = await saveResultFile(generationId, file);
    const updated = await withTransientDbRetry("update", () =>
      db.generation.update({
        where: { id: generationId },
        data: {
          status: "SUCCESS",
          resultUrl,
          resultMessage: null,
          errorMessage: null,
        },
      }),
    );

    return NextResponse.json({ ok: true, generation: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[syntx/complete]", generationId, message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
