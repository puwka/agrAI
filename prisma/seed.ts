import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { buildPreviewDataUrl } from "../lib/generation-preview";

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await hash("admin12345", 10);
  const userPasswordHash = await hash("user12345", 10);

  const admin = await prisma.user.upsert({
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

  const user = await prisma.user.upsert({
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

  await prisma.apiKey.deleteMany({
    where: {
      userId: { in: [admin.id, user.id] },
    },
  });

  await prisma.generation.deleteMany({
    where: {
      userId: { in: [admin.id, user.id] },
    },
  });

  await prisma.apiKey.createMany({
    data: [
      {
        userId: admin.id,
        name: "Admin Master Key",
        token: "agr_admin_live_master_4m8q_9xlp",
        status: "ACTIVE",
        scope: "admin:all, generations:read, users:read",
        monthlyQuota: 100000,
        usageCount: 18240,
        lastUsedAt: new Date(),
      },
      {
        userId: user.id,
        name: "User Web Key",
        token: "agr_user_web_key_7dkm_1qwe",
        status: "ACTIVE",
        scope: "generations:create, generations:read",
        monthlyQuota: 25000,
        usageCount: 1204,
        lastUsedAt: new Date(),
      },
      {
        userId: user.id,
        name: "Sandbox Key",
        token: "agr_user_sandbox_2mnb_7rtz",
        status: "LIMITED",
        scope: "generations:read",
        monthlyQuota: 5000,
        usageCount: 488,
        lastUsedAt: new Date(Date.now() - 1000 * 60 * 60 * 6),
      },
    ],
  });

  const userPreview = buildPreviewDataUrl(
    "Model B",
    "Cyberpunk portrait with neon rim light and cinematic rain",
    "16:9",
  );
  const adminPreview = buildPreviewDataUrl(
    "Model C",
    "Admin overview concept with glassmorphism cards and violet glow",
    "16:9",
  );

  await prisma.generation.createMany({
    data: [
      {
        userId: user.id,
        modelId: "model-b",
        modelName: "Model B",
        prompt: "Cyberpunk portrait with neon rim light and cinematic rain",
        aspectRatio: "16:9",
        status: "SUCCESS",
        resultUrl: userPreview,
      },
      {
        userId: user.id,
        modelId: "model-c",
        modelName: "Model C",
        prompt: "Vertical ad concept for AI aggregator landing page",
        aspectRatio: "9:16",
        status: "SUCCESS",
        resultUrl: buildPreviewDataUrl(
          "Model C",
          "Vertical ad concept for AI aggregator landing page",
          "9:16",
        ),
      },
      {
        userId: admin.id,
        modelId: "model-c",
        modelName: "Model C",
        prompt: "Admin overview concept with glassmorphism cards and violet glow",
        aspectRatio: "16:9",
        status: "SUCCESS",
        resultUrl: adminPreview,
      },
    ],
  });

  const settingsRow = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (!settingsRow) {
    await prisma.appSettings.create({
      data: {
        id: "global",
        maintenanceEnabled: false,
        maintenanceMessage: "Ведутся технические работы. Генерация временно недоступна.",
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
