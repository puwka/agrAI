import { unlink } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { db } from "../../../../../lib/db";
import { getApiSessionUser } from "../../../../../lib/auth/api-session";

const UPLOADS_GENERATIONS = path.join(process.cwd(), "public", "uploads", "generations");

function isUploadedGenerationFile(absPath: string) {
  const normalized = path.normalize(absPath);
  const root = path.normalize(UPLOADS_GENERATIONS);
  return normalized === root || normalized.startsWith(root + path.sep);
}

async function tryRemoveReferenceUpload(refUrl: string | null) {
  const raw = refUrl?.trim();
  if (!raw?.startsWith("/uploads/generations/references/")) return;

  const pathname = (raw.split("?")[0] ?? "").trim();
  const segments = pathname.split("/").filter(Boolean);
  const rel = path.join(...segments);
  const abs = path.join(process.cwd(), "public", rel);

  if (!isUploadedGenerationFile(abs)) return;
  if (!pathname.startsWith("/uploads/generations/references/")) return;

  try {
    await unlink(abs);
  } catch {
    // ignore
  }
}

async function tryRemoveUploadedResultFile(resultUrl: string | null, generationId: string) {
  const raw = resultUrl?.trim();
  if (!raw || !raw.startsWith("/uploads/generations/")) return;

  const pathname = (raw.split("?")[0] ?? "").trim();
  if (!pathname.startsWith("/uploads/generations/")) return;

  const segments = pathname.split("/").filter(Boolean);
  const rel = path.join(...segments);
  const abs = path.join(process.cwd(), "public", rel);

  if (!isUploadedGenerationFile(abs)) return;
  if (!path.basename(abs).startsWith(generationId)) return;

  try {
    await unlink(abs);
  } catch {
    // файл уже отсутствует — не мешаем удалению записи в БД
  }
}

const MAX_MESSAGE_LEN = 8000;

function isValidResultUrl(value: string) {
  const v = value.trim();
  if (v.length < 12) return false;
  if (v.startsWith("data:image/") || v.startsWith("data:video/") || v.startsWith("data:audio/")) {
    return true;
  }
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const generationId = id?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  let body: { resultUrl?: string | null; resultMessage?: string | null };
  try {
    body = (await request.json()) as { resultUrl?: string | null; resultMessage?: string | null };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const urlSpecified = Object.prototype.hasOwnProperty.call(body, "resultUrl");
  const msgSpecified = Object.prototype.hasOwnProperty.call(body, "resultMessage");

  if (!urlSpecified && !msgSpecified) {
    return NextResponse.json(
      { error: "Передайте resultUrl и/или resultMessage" },
      { status: 400 },
    );
  }

  const existing = await db.generation.findUnique({
    where: { id: generationId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Генерация не найдена" }, { status: 404 });
  }

  let nextUrl = existing.resultUrl;
  let nextMsg = existing.resultMessage;

  if (urlSpecified) {
    const v = body.resultUrl;
    if (v === null) {
      nextUrl = null;
    } else if (typeof v === "string") {
      const t = v.trim();
      if (t.length === 0) {
        nextUrl = null;
      } else if (!isValidResultUrl(t)) {
        return NextResponse.json(
          { error: "Укажите корректный URL (https://…) или data:… для файла результата" },
          { status: 400 },
        );
      } else {
        nextUrl = t;
      }
    } else {
      return NextResponse.json({ error: "resultUrl: ожидается строка или null" }, { status: 400 });
    }
  }

  if (msgSpecified) {
    const v = body.resultMessage;
    if (v === null) {
      nextMsg = null;
    } else if (typeof v === "string") {
      const t = v.trim();
      if (t.length === 0) {
        nextMsg = null;
      } else if (t.length > MAX_MESSAGE_LEN) {
        return NextResponse.json(
          { error: `Текст не длиннее ${MAX_MESSAGE_LEN} символов` },
          { status: 400 },
        );
      } else {
        nextMsg = t;
      }
    } else {
      return NextResponse.json(
        { error: "resultMessage: ожидается строка или null" },
        { status: 400 },
      );
    }
  }

  const hasDelivery = Boolean(nextUrl?.trim() || nextMsg?.trim());
  if (!hasDelivery) {
    return NextResponse.json(
      { error: "Должен остаться файл (ссылка) и/или непустой текст для клиента" },
      { status: 400 },
    );
  }

  const updated = await db.generation.update({
    where: { id: generationId },
    data: {
      resultUrl: nextUrl?.trim() || null,
      resultMessage: nextMsg?.trim() || null,
      status: "SUCCESS",
      errorMessage: null,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const generationId = id?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }

  const existing = await db.generation.findUnique({
    where: { id: generationId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Генерация не найдена" }, { status: 404 });
  }

  await tryRemoveUploadedResultFile(existing.resultUrl, generationId);
  await tryRemoveReferenceUpload(existing.referenceImageUrl);
  await db.generation.delete({ where: { id: generationId } });

  return NextResponse.json({ ok: true });
}
