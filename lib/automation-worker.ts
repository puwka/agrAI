import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

const SYNTX_VEO_URL = "https://syntx.ai/video/veo3";
const SYNTX_SORA_IMAGE_URL = "https://syntx.ai/image/sora-images";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function requireAutomationWorker(request: Request): NextResponse | null {
  const expected =
    process.env.SYNTX_WORKER_TOKEN?.trim() ||
    process.env.AUTOMATION_WORKER_TOKEN?.trim() ||
    "";
  if (!expected) {
    return NextResponse.json({ error: "Worker token is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const token = bearer || request.headers.get("x-worker-token")?.trim() || "";

  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export function isSyntxVeoGeneration(row: {
  modelId?: string | null;
  modelName?: string | null;
  prompt?: string | null;
}) {
  if (row.modelId !== "video") return false;
  const modelName = (row.modelName ?? "").toLowerCase();
  const prompt = row.prompt ?? "";
  return modelName.includes("veo 3.1") && /\[VeoResolution:(720p|1080p)\]/i.test(prompt);
}

export function isSyntxSoraImageGeneration(row: {
  modelId?: string | null;
  modelName?: string | null;
}) {
  if (row.modelId !== "photo") return false;
  const modelName = (row.modelName ?? "").toLowerCase();
  return modelName.includes("sora image");
}

export function isSyntxGeneration(row: {
  modelId?: string | null;
  modelName?: string | null;
  prompt?: string | null;
}) {
  return isSyntxVeoGeneration(row) || isSyntxSoraImageGeneration(row);
}

export function extractVeoResolution(prompt: string): "720p" | "1080p" {
  const m = /\[VeoResolution:(720p|1080p)\]/i.exec(prompt ?? "");
  const v = m?.[1]?.toLowerCase();
  return v === "720p" ? "720p" : "1080p";
}

export function extractReferenceImages(prompt: string): string[] {
  const refs: string[] = [];
  const re = /\[RefImage:(.+?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt ?? "")) !== null) {
    const raw = (m[1] ?? "").trim();
    if (raw) refs.push(raw);
  }
  return refs;
}

export function cleanPromptForSyntx(prompt: string) {
  return (prompt ?? "")
    .replace(/\s*\[RefImage:.+?\]\s*/g, "\n")
    .replace(/\s*\[VeoResolution:(720p|1080p)\]\s*/gi, "\n")
    .replace(/\s*\[RepeatOf:[^\]]+\]\s*/gi, "\n")
    .replace(/\s*\[Repeat\]\s*/gi, "\n")
    .trim();
}

export function serializeSyntxJob(job: ReturnType<typeof mapSyntxJob>) {
  return {
    ...job,
    createdAt:
      job.createdAt instanceof Date
        ? job.createdAt.toISOString()
        : job.createdAt != null
          ? String(job.createdAt)
          : null,
    updatedAt:
      job.updatedAt instanceof Date
        ? job.updatedAt.toISOString()
        : job.updatedAt != null
          ? String(job.updatedAt)
          : null,
  };
}

export function mapSyntxJob(row: any) {
  const prompt = String(row.prompt ?? "");
  const referenceImages = [
    typeof row.referenceImageUrl === "string" ? row.referenceImageUrl.trim() : "",
    ...extractReferenceImages(prompt),
  ].filter(Boolean);
  const isSoraImage = isSyntxSoraImageGeneration(row);

  return {
    id: row.id,
    service: "syntx",
    targetUrl: isSoraImage ? SYNTX_SORA_IMAGE_URL : SYNTX_VEO_URL,
    model: isSoraImage ? "sora-image" : "veo-3.1-relax",
    prompt: cleanPromptForSyntx(prompt),
    aspectRatio: row.aspectRatio,
    inputMode: row.inputMode ?? "TEXT",
    referenceImages,
    ...(isSoraImage ? {} : { resolution: extractVeoResolution(prompt) }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userId: row.userId,
  };
}
