import { navItems } from "./config";
import type { NavItem } from "./types";

export { buildPreviewDataUrl } from "../../lib/generation-preview";

/** По URL результата: карточки истории и превью (аудио нельзя отдавать в img). */
export function detectResultMediaKind(url: string): "image" | "video" | "audio" {
  const v = (url ?? "").trim().toLowerCase();
  if (!v) return "image";
  if (v.startsWith("data:video/")) return "video";
  if (v.startsWith("data:audio/")) return "audio";
  if (v.startsWith("data:image/")) return "image";
  const clean = v.split("?")[0] ?? v;
  if (/\.(mp4|webm|mov|m4v)$/i.test(clean)) return "video";
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i.test(clean)) return "audio";
  return "image";
}

/** Убирает технический id из префикса `[Голос: Имя (voiceId)]` (старые записи в БД). */
export function formatPromptForLogsDisplay(prompt: string): string {
  if (!prompt || typeof prompt !== "string") return prompt;
  return prompt
    .replace(/^\[Голос:\s*(.+?)\s*\([^)]+\)\s*\]/, "[Голос: $1]")
    .replace(/\s*\[RefImage:.+?\]\s*/g, "\n")
    .replace(/\s*\[RunwayDurationSec:\d+\]\s*/g, "\n")
    .replace(/\s*\[VeoResolution:(720p|1080p)\]\s*/g, "\n")
    .trim();
}

export function getActiveNavItem(pathname: string): NavItem {
  const activeItem = navItems.find((item) => {
    if (item.href === "/dashboard") {
      return pathname === "/dashboard";
    }

    return pathname.startsWith(item.href);
  });

  return activeItem ?? navItems[0];
}

export function maskApiKey(value: string) {
  if (value.length < 10) {
    return value;
  }

  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

export function getStatusTone(status: "active" | "limited" | "success" | "queued" | "error") {
  switch (status) {
    case "active":
    case "success":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
    case "queued":
      return "border-amber-400/20 bg-amber-500/10 text-amber-200";
    case "limited":
      return "border-sky-400/20 bg-sky-500/10 text-sky-200";
    case "error":
      return "border-red-400/20 bg-red-500/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-zinc-300";
  }
}

export function mapGenerationStatusToLogStatus(
  status: string,
): "success" | "queued" | "error" {
  if (status === "ERROR") {
    return "error";
  }
  if (status === "QUEUED" || status === "PENDING") {
    return "queued";
  }
  return "success";
}

export function formatGenerationStatusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Ожидает результата";
    case "QUEUED":
      return "В очереди";
    case "SUCCESS":
      return "Готово";
    case "ERROR":
      return "Ошибка";
    default:
      return status;
  }
}

export function formatGenerationDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
