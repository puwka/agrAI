import { hash } from "bcryptjs";

import { db } from "./db";
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
 * Вызывается из instrumentation и из NextAuth `authorize`, чтобы сработало и при `VERCEL_ENV=production`.
 */
export async function ensureVercelSqliteReady(): Promise<void> {
  if (process.env.VERCEL !== "1") return;
  ensureVercelSqliteFileInTmp();
  if (!isSqliteFileDatabaseUrl(process.env.DATABASE_URL ?? "")) return;

  if (!globalForMigrate.__agraiPrismaMigrateDeployed) {
    try {
      runPrismaMigrateDeploySync();
      globalForMigrate.__agraiPrismaMigrateDeployed = true;
    } catch (e) {
      console.error("[agrai] prisma migrate deploy:", e);
      return;
    }
  }

  await seedDemoUsersIfEmpty();
}
