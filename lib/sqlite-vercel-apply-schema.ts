import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INIT_MIGRATION_REL = "prisma/migrations/20260401000000_init_schema/migration.sql";

function sqliteFsPathFromDatabaseUrl(databaseUrl: string): string {
  const u = databaseUrl.trim();
  if (!u.startsWith("file:")) {
    throw new Error(`Ожидался SQLite file: URL, получено: ${databaseUrl.slice(0, 48)}`);
  }
  try {
    return fileURLToPath(new URL(u));
  } catch {
    const rest = u.slice("file:".length).replace(/^\/+/, "");
    return path.resolve(process.cwd(), rest);
  }
}

/**
 * На Vercel без Prisma CLI: тот же SQL, что в init-миграции.
 * `node:sqlite` только через dynamic import — иначе Edge/Turbopack тянут модуль на `/login` и дают 500.
 */
export async function applyVercelSqliteInitSchemaFromMigration(): Promise<boolean> {
  if (process.env.VERCEL !== "1") return true;
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.startsWith("file:")) return true;

  let native: import("node:sqlite").DatabaseSync | undefined;

  try {
    const { DatabaseSync } = await import("node:sqlite");

    const dbPath = sqliteFsPathFromDatabaseUrl(databaseUrl);
    const migrationPath = path.join(process.cwd(), INIT_MIGRATION_REL);
    if (!existsSync(migrationPath)) {
      console.error("[agrai] нет файла миграции:", migrationPath);
      return false;
    }

    const sql = readFileSync(migrationPath, "utf8");
    native = new DatabaseSync(dbPath);

    const check = native.prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'User'",
    );
    const row = check.get() as { c: number } | undefined;
    if (row && Number(row.c) > 0) {
      return true;
    }

    native.exec(sql);
    return true;
  } catch (e) {
    try {
      if (native) {
        const check = native.prepare(
          "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'User'",
        );
        const row = check.get() as { c: number } | undefined;
        if (row && Number(row.c) > 0) {
          return true;
        }
      }
    } catch {
      /* ignore */
    }
    console.error("[agrai] применение migration.sql через node:sqlite:", e);
    return false;
  } finally {
    native?.close();
  }
}
