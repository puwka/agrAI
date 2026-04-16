/**
 * На Vercel каталог деплоя только для чтения; SQLite только в `/tmp`.
 * Если в `DATABASE_URL` указан `file:` не в системном `/tmp/`, Prisma часто попадает в пустой файл без миграций → «таблица User не существует».
 */
export function ensureVercelSqliteFileInTmp(): void {
  if (process.env.VERCEL !== "1") return;
  const u = process.env.DATABASE_URL ?? "";
  if (!u.startsWith("file:")) return;
  if (u.startsWith("file:/tmp/") || u.startsWith("file:///tmp/")) return;
  process.env.DATABASE_URL = "file:/tmp/agrai.db";
}

export function isSqliteFileDatabaseUrl(url: string): boolean {
  return url.startsWith("file:");
}
