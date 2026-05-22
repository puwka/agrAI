import { NextResponse } from "next/server";

import { db } from "../../../../../../lib/db";
import { getApiSessionUser } from "../../../../../../lib/auth/api-session";
import { saveLocalGenerationResultFile } from "../../../../../../lib/local-generation-result";
import { inferUploadExtAndMime } from "../../../../../../lib/upload-media-infer";

const MAX_BYTES = 80 * 1024 * 1024;

/** Повтор db.generation.update с короткими паузами (до 3 попыток). */
async function updateGenerationWithRetry(
  generationId: string,
  resultUrl: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const updated = await db.generation.update({
        where: { id: generationId },
        data: {
          resultUrl,
          resultMessage: null,
          status: "SUCCESS",
          errorMessage: null,
        },
      });
      return { ok: true, data: updated };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[admin/upload] update attempt ${attempt}/3 failed:`, msg);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "exhausted retries" };
}

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

  let existing;
  try {
    existing = await db.generation.findUnique({
      where: { id: generationId },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось найти генерацию (таймаут БД)." }, { status: 502 });
  }

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

  const { ext } = inferUploadExtAndMime(file);
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Сохраняем файл на диск — это быстрая локальная операция.
  let resultUrl: string;
  try {
    resultUrl = await saveLocalGenerationResultFile({ generationId, ext, buffer });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Не удалось сохранить файл (${msg}).` },
      { status: 500 },
    );
  }

  // 2. Обновляем БД — retry до 3 раз. Файл уже на диске, поэтому
  //    даже если update не прошёл — возвращаем успех, чтобы не пугать
  //    ложной ошибкой. При следующей загрузке страницы БД подтянется.
  const result = await updateGenerationWithRetry(generationId, resultUrl);
  if (!result.ok) {
    console.error(
      `[admin/upload] file saved but DB update failed for ${generationId}: ${result.error}`,
    );
    // Файл сохранён — отдаём 200 с предупреждением, а не 503.
    return NextResponse.json({
      id: generationId,
      resultUrl,
      status: "SUCCESS",
      _warning: "Файл сохранён, но статус в БД не обновился. Обновите страницу или повторите.",
    });
  }

  return NextResponse.json(result.data);
}
