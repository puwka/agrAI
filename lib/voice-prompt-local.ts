import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const VOICE_PROMPT_DIR = path.join(process.cwd(), "local-data", "voice-prompts");
const MARKER_RE = /\[VoicePromptLocal:([a-z0-9-]+)\]/i;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function promptFilePath(id: string): string {
  return path.join(VOICE_PROMPT_DIR, `${id}.txt`);
}

export async function saveVoicePromptLocal(content: string): Promise<string> {
  const text = String(content ?? "");
  const id = randomId().toLowerCase();
  await mkdir(VOICE_PROMPT_DIR, { recursive: true });
  await writeFile(promptFilePath(id), text, "utf8");
  return `[VoicePromptLocal:${id}]`;
}

export function extractVoicePromptLocalId(prompt: string): string | null {
  const m = MARKER_RE.exec(prompt ?? "");
  const id = (m?.[1] ?? "").trim();
  return id || null;
}

export async function resolveVoicePromptLocal(prompt: string): Promise<string> {
  const source = String(prompt ?? "");
  const id = extractVoicePromptLocalId(source);
  if (!id) return source;
  try {
    const content = await readFile(promptFilePath(id), "utf8");
    return content.trim();
  } catch {
    return source.replace(MARKER_RE, "").trim();
  }
}
