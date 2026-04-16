import type { NextConfig } from "next";

/** Prisma Client + чтение `prisma/migrations/*.sql` в рантайме (без Prisma CLI) */
const prismaRuntimeTrace = [
  "./node_modules/@prisma/engines/**/*",
  "./node_modules/.prisma/**/*",
  "./prisma/migrations/**/*",
  "./prisma/schema.prisma",
];

const nextConfig: NextConfig = {
  /** Уменьшает предупреждения при строгих проверках пакетов на Vercel */
  serverExternalPackages: ["@prisma/client", "prisma"],
  /** Engines + SQL миграций для Prisma Client и `node:sqlite` на Vercel */
  outputFileTracingIncludes: {
    "/api/**/*": prismaRuntimeTrace,
    instrumentation: prismaRuntimeTrace,
  },
};

export default nextConfig;
