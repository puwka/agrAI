/**
 * На Vercel: next-auth v4 (preview URL) + SQLite в `/tmp` (миграции и демо-учётки).
 * См. `lib/vercel-sqlite-bootstrap.ts` — та же логика вызывается из `authorize` на случай обхода instrumentation.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.VERCEL !== "1") return;

  if (process.env.VERCEL_URL) {
    if (process.env.VERCEL_ENV === "preview") {
      process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
    } else if (!process.env.NEXTAUTH_URL?.trim()) {
      /* прод без NEXTAUTH_URL в Vercel — подставляем origin деплоя */
      process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
    }
  }

  try {
    const { ensureVercelSqliteReady } = await import("./lib/vercel-sqlite-bootstrap");
    const ok = await ensureVercelSqliteReady();
    if (!ok) {
      console.error("[instrumentation] ensureVercelSqliteReady: миграции или сид не прошли");
    }
  } catch (err) {
    console.error("[instrumentation] ensureVercelSqliteReady:", err);
  }
}
