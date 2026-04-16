import { PrismaClient } from "@prisma/client";

import { ensureVercelSqliteFileInTmp } from "./vercel-sqlite-url";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  /** После смены `DATABASE_URL` (напр. на Vercel → `/tmp`) старый клиент смотрел в пустой файл без миграций */
  prismaDatasourceUrl?: string;
};

function getPrismaClient(): PrismaClient {
  ensureVercelSqliteFileInTmp();
  const url = process.env.DATABASE_URL ?? "";
  const existing = globalForPrisma.prisma;
  if (existing && globalForPrisma.prismaDatasourceUrl !== url) {
    void existing.$disconnect();
    globalForPrisma.prisma = undefined;
    globalForPrisma.prismaDatasourceUrl = undefined;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
    globalForPrisma.prismaDatasourceUrl = url;
  }
  return globalForPrisma.prisma;
}

/** Вызвать перед миграциями/запросами, если `DATABASE_URL` мог измениться (Vercel + SQLite). */
export function syncPrismaClientWithEnv(): void {
  getPrismaClient();
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
}) as unknown as PrismaClient;
