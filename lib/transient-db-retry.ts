function isTransientSupabaseMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("supabase_fetch") ||
    m.includes("supabase_timeout") ||
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("socket hang up") ||
    m.includes("terminated")
  );
}

function retryAttemptsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  return Math.max(1, Math.min(8, Number.isFinite(n) ? n : fallback));
}

/** Повторы для PostgREST при временных сетевых сбоях (poll/complete воркера). */
export async function withTransientDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { envVar?: string; fallbackAttempts?: number },
): Promise<T> {
  const envVar = opts?.envVar ?? "SYNTX_COMPLETE_DB_RETRIES";
  const attempts = retryAttemptsFromEnv(envVar, opts?.fallbackAttempts ?? 5);
  let last: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (i < attempts && isTransientSupabaseMessage(msg)) {
        console.warn(`[db-retry] ${label} attempt ${i}/${attempts}:`, msg);
        await new Promise((r) => setTimeout(r, 450 * i));
        continue;
      }
      throw e;
    }
  }
  throw last;
}
