import { hash } from "bcryptjs";

import { db, syncPrismaClientWithEnv } from "./db";
import { runPrismaMigrateDeploySync } from "./run-prisma-migrate-deploy";
import { ensureVercelSqliteFileInTmp, isSqliteFileDatabaseUrl } from "./vercel-sqlite-url";

const globalForMigrate = globalThis as unknown as {
  __agraiPrismaMigrateDeployed?: boolean;
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
 * На Vercel + SQLite в `/tmp` каждый холодный старт — пустая БД: миграции + демо-учётки (как в seed).
 * @returns false если миграции/сид не удались — тогда нельзя дергать Prisma (нет таблиц).
 */
export async function ensureVercelSqliteReady(): Promise<boolean> {
  if (process.env.VERCEL !== "1") return true;
  ensureVercelSqliteFileInTmp();
  if (!isSqliteFileDatabaseUrl(process.env.DATABASE_URL ?? "")) return true;

  syncPrismaClientWithEnv();

  if (!globalForMigrate.__agraiPrismaMigrateDeployed) {
    try {
      runPrismaMigrateDeploySync();
      globalForMigrate.__agraiPrismaMigrateDeployed = true;
    } catch (e) {
      console.error("[agrai] prisma migrate deploy:", e);
      return false;
    }
  }

  try {
    await seedDemoUsersIfEmpty();
  } catch (e) {
    console.error("[agrai] seed demo users:", e);
    return false;
  }

  return true;
}
