import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Prisma остаётся node external в server runtime */
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
