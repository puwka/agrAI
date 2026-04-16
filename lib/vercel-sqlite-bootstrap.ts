import { hash } from "bcryptjs";

import { db } from "./db";

/**
 * На Vercel + SQLite в `/tmp` каждый холодный старт — новый файл БД: миграции есть, строк нет.
 * Создаём тех же демо-пользователей, что и в `prisma/seed.ts`, чтобы вход на preview работал.
 * Прод: только при `AGRAI_BOOTSTRAP_DEMO=1` (временная демо-БД в /tmp без Turso).
 */
export async function bootstrapVercelSqliteIfEmpty(): Promise<void> {
  if (process.env.VERCEL !== "1") return;
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("/tmp")) return;

  const count = await db.user.count();
  if (count > 0) return;

  const allow =
    process.env.VERCEL_ENV === "preview" ||
    process.env.AGRAI_BOOTSTRAP_DEMO === "1";
  if (!allow) return;

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
