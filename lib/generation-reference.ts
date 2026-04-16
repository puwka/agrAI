import { access } from "node:fs/promises";
import path from "node:path";

const REFERENCES_DIR = path.join(process.cwd(), "public", "uploads", "generations", "references");

export function referenceUrlBasename(url: string) {
  const pathname = (url.split("?")[0] ?? "").trim();
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export async function isValidUserReferenceImageUrl(url: string | null | undefined, userId: string) {
  if (!url?.trim()) return false;
  const pathname = (url.split("?")[0] ?? "").trim();
  if (!pathname.startsWith("/uploads/generations/references/")) return false;

  const base = referenceUrlBasename(pathname);
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) return false;
  if (!base.startsWith(`${userId}-`)) return false;

  const abs = path.join(process.cwd(), "public", "uploads", "generations", "references", base);
  const normalized = path.normalize(abs);
  const root = path.normalize(REFERENCES_DIR);
  if (normalized !== root && !normalized.startsWith(root + path.sep)) return false;

  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}
