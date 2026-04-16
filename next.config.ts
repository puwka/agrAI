import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Уменьшает предупреждения при строгих проверках пакетов на Vercel */
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
