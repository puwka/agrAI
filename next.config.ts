import type { NextConfig } from "next";

/** Файлы для `prisma migrate deploy` в рантайме (Vercel serverless + SQLite) */
const prismaRuntimeTrace = [
  "./node_modules/prisma/**/*",
  "./node_modules/@prisma/engines/**/*",
  "./node_modules/.prisma/**/*",
  "./prisma/migrations/**/*",
  "./prisma/schema.prisma",
];

const nextConfig: NextConfig = {
  /** Уменьшает предупреждения при строгих проверках пакетов на Vercel */
  serverExternalPackages: ["@prisma/client", "prisma"],
  /** Иначе CLI/engines/migrations не попадают в serverless-артефакт */
  outputFileTracingIncludes: {
    "/api/**/*": prismaRuntimeTrace,
    instrumentation: prismaRuntimeTrace,
  },
};

export default nextConfig;
