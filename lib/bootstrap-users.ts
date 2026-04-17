import { db } from "./db";

const DEFAULT_USERS = [
  {
    id: "admin-seed",
    name: "Admin agrAI",
    email: "admin@agrai.dev",
    // admin12345
    passwordHash: "$2b$10$YMoVWHI4K5lqweliNLKSv.MFUHze6eh/bAZv2z9Hy68rkzY2IvwH2",
    role: "ADMIN",
  },
  {
    id: "user-seed",
    name: "Demo User",
    email: "user@agrai.dev",
    // user12345
    passwordHash: "$2b$10$KKHcUycUd1h44BhO1nG5BeA/4n.2LdRTe1kNXM60V/2rXwQChgJm.",
    role: "USER",
  },
] as const;

const globalForBootstrap = globalThis as unknown as {
  usersBootstrapped?: boolean;
};

/**
 * Радикальный фолбэк для деплоя:
 * если база пустая/новая, гарантируем наличие дефолтных аккаунтов для входа.
 */
export async function ensureDefaultUsersForAuth() {
  if (globalForBootstrap.usersBootstrapped) return;

  try {
    for (const candidate of DEFAULT_USERS) {
      const existing = await db.user.findUnique({
        where: { email: candidate.email },
        select: {
          id: true,
          subscriptionUntil: true,
        },
      });
      const yearMs = 365 * 24 * 60 * 60 * 1000;

      if (existing) {
        const data: Record<string, unknown> = {
          name: candidate.name,
          role: candidate.role,
          passwordHash: candidate.passwordHash,
        };
        if (candidate.role === "USER") {
          const sub = existing.subscriptionUntil as Date | null | undefined;
          if (!sub || sub.getTime() <= Date.now()) {
            data.subscriptionUntil = new Date(Date.now() + yearMs);
          }
        }
        await db.user.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await db.user.create({
          data: {
            id: candidate.id,
            name: candidate.name,
            email: candidate.email,
            role: candidate.role,
            passwordHash: candidate.passwordHash,
            notificationsEnabled: true,
            weeklyReportEnabled: false,
            defaultAspectRatio: "16:9",
            subscriptionUntil:
              candidate.role === "USER" ? new Date(Date.now() + yearMs) : null,
          },
        });
      }
    }

    globalForBootstrap.usersBootstrapped = true;
  } catch (error) {
    console.error("[bootstrap-users] failed:", error);
  }
}

