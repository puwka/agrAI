import { hash } from "bcryptjs";

import { db, syncPrismaClientWithEnv } from "./db";
import { ensureVercelSqliteFileInTmp, isSqliteFileDatabaseUrl } from "./vercel-sqlite-url";

const globalForSchema = globalThis as unknown as {
  __agraiSqliteInitSchemaApplied?: boolean;
};

async function seedDemoUsersIfEmpty(): Promise<void> {
  const count = await db.user.count();
  if (count > 0) return;

  const adminPasswordHash = await hash("admin12345", 10);
  const userPasswordHash = await hash("user12345", 10);

  await db.user.upsert({
    where: { email: "admin@agrai.dev" },
    update: {
      name: "Admin agrAI",
      role: "ADMIN",
      passwordHash: adminPasswordHash,
      company: "agrAI",
      telegram: "@admin_agrai",
    },
    create: {
      name: "Admin agrAI",
      email: "admin@agrai.dev",
      role: "ADMIN",
      passwordHash: adminPasswordHash,
      company: "agrAI",
      telegram: "@admin_agrai",
    },
  });

  await db.user.upsert({
    where: { email: "user@agrai.dev" },
    update: {
      name: "Demo User",
      role: "USER",
      passwordHash: userPasswordHash,
      company: "Client Team",
      telegram: "@demo_user",
    },
    create: {
      name: "Demo User",
      email: "user@agrai.dev",
      role: "USER",
      passwordHash: userPasswordHash,
      company: "Client Team",
      telegram: "@demo_user",
    },
  });
}

/**
 * Vercel + SQLite в `/tmp`: схема через `node:sqlite` + тот же SQL, что в миграции (без Prisma CLI в рантайме).
 * @returns false если схема/сид не удались.
 */
export async function ensureVercelSqliteReady(): Promise<boolean> {
  if (process.env.VERCEL !== "1") return true;
  ensureVercelSqliteFileInTmp();
  if (!isSqliteFileDatabaseUrl(process.env.DATABASE_URL ?? "")) return true;

  syncPrismaClientWithEnv();

  if (!globalForSchema.__agraiSqliteInitSchemaApplied) {
    const { applyVercelSqliteInitSchemaFromMigration } = await import("./sqlite-vercel-apply-schema");
    const ok = await applyVercelSqliteInitSchemaFromMigration();
    if (!ok) {
      return false;
    }
    globalForSchema.__agraiSqliteInitSchemaApplied = true;
  }

  try {
    await seedDemoUsersIfEmpty();
  } catch (e) {
    console.error("[agrai] seed demo users:", e);
    return false;
  }

  return true;
}
