import Link from "next/link";

export function RestrictedAccessView({
  until,
  reason,
}: {
  until: Date | null;
  reason: string | null;
}) {
  const message = reason?.trim() ? reason.trim() : "Злоупотребление генерациями.";
  const untilText = until
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(until)
    : null;

  return (
    <section className="rounded-[28px] border border-red-400/20 bg-red-500/10 p-6 backdrop-blur-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-200/80">
        Доступ ограничен
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white">Злоупотребление генерациями</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200/80">{message}</p>
      {untilText ? (
        <p className="mt-4 text-sm text-zinc-300">
          Ограничение действует до: <span className="font-semibold text-white">{untilText}</span>
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/login"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Войти в другой аккаунт
        </Link>
        <Link
          href="/dashboard/profile"
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-black/30"
        >
          Профиль (если доступно)
        </Link>
      </div>
    </section>
  );
}

