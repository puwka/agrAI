import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FileCustomVoice = {
  voiceId: string;
  name: string;
  gender: string;
  locale: string;
  previewUrl: string;
  tagsJson: string;
  createdAt?: string;
  updatedAt?: string;
};

const CUSTOM_VOICES_FILE = path.join(process.cwd(), "voices", "custom-voices.json");

function normalizeVoice(input: Partial<FileCustomVoice>): FileCustomVoice | null {
  const voiceId = String(input.voiceId ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!voiceId || !name) return null;
  return {
    voiceId,
    name,
    gender: String(input.gender ?? "").trim(),
    locale: String(input.locale ?? "").trim(),
    previewUrl: String(input.previewUrl ?? "").trim(),
    tagsJson: String(input.tagsJson ?? "[]").trim() || "[]",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function ensureDir() {
  await mkdir(path.dirname(CUSTOM_VOICES_FILE), { recursive: true });
}

export async function readCustomVoicesFile(): Promise<FileCustomVoice[]> {
  try {
    const raw = await readFile(CUSTOM_VOICES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeVoice(item as Partial<FileCustomVoice>)).filter(Boolean) as FileCustomVoice[];
  } catch {
    return [];
  }
}

export async function upsertCustomVoiceFile(input: FileCustomVoice): Promise<FileCustomVoice[]> {
  await ensureDir();
  const list = await readCustomVoicesFile();
  const nowIso = new Date().toISOString();
  const normalized = normalizeVoice(input);
  if (!normalized) return list;
  const idx = list.findIndex((item) => item.voiceId === normalized.voiceId);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...normalized,
      createdAt: prev.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
  } else {
    list.unshift({
      ...normalized,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  await writeFile(CUSTOM_VOICES_FILE, `${JSON.stringify(list, null, 2)}\n`, "utf-8");
  return list;
}

export async function deleteCustomVoiceFile(voiceId: string): Promise<FileCustomVoice[]> {
  await ensureDir();
  const id = voiceId.trim();
  if (!id) return readCustomVoicesFile();
  const list = await readCustomVoicesFile();
  const next = list.filter((item) => item.voiceId !== id);
  await writeFile(CUSTOM_VOICES_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  return next;
}
