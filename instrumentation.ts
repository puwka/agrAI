import { execSync } from "node:child_process";

/**
 * На Vercel файловая система функции доступна для записи в основном в `/tmp`.
 * Если `DATABASE_URL` указывает на SQLite в `/tmp`, при старте инстанса применяем миграции,
 * чтобы схема существовала (данные при холодном старте с пустой БД — ограничение serverless + SQLite).
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.VERCEL !== "1") return;

  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("/tmp")) return;

  try {
    execSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
  } catch (err) {
    console.error("[instrumentation] prisma migrate deploy:", err);
  }
}
