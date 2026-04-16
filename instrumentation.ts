/**
 * На Vercel файловая система функции доступна для записи в основном в `/tmp`.
 * Если `DATABASE_URL` указывает на SQLite в `/tmp`, при старте инстанса применяем миграции,
 * чтобы схема существовала (данные при холодном старте с пустой БД — ограничение serverless + SQLite).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.VERCEL !== "1") return;

  /* next-auth v4: на preview хост меняется; иначе CSRF/куки и POST /callback/credentials дают 401 */
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("/tmp")) return;

  try {
    const { execSync } = await import("node:child_process");
    execSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
  } catch (err) {
    console.error("[instrumentation] prisma migrate deploy:", err);
  }

  try {
    const { bootstrapVercelSqliteIfEmpty } = await import("./lib/vercel-sqlite-bootstrap");
    await bootstrapVercelSqliteIfEmpty();
  } catch (err) {
    console.error("[instrumentation] sqlite bootstrap:", err);
  }
}
