import Link from "next/link";

export function SubscriptionExpiredView({ until }: { until: Date | null }) {
  const untilText = until
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(until)
    : null;

  return (
    <section className="rounded-[28px] border border-amber-400/25 bg-amber-500/10 p-6 backdrop-blur-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/90">
        Подписка
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white">Подписка закончилась</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200/90">
        Срок действия вашей подписки истёк. Создание новых заявок на генерацию недоступно до продления.
      </p>
      {untilText ? (
        <p className="mt-4 text-sm text-zinc-300">
          Подписка действовала до: <span className="font-semibold text-white">{untilText}</span>
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="mailto:?subject=%D0%9F%D1%80%D0%BE%D0%B4%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BF%D0%BE%D0%B4%D0%BF%D0%B8%D1%81%D0%BA%D0%B8%20agrAI&body=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5%2C%20%D0%BD%D1%83%D0%B6%D0%BD%D0%BE%20%D0%BF%D1%80%D0%BE%D0%B4%D0%BB%D0%B8%D1%82%D1%8C%20%D0%BF%D0%BE%D0%B4%D0%BF%D0%B8%D1%81%D0%BA%D1%83%20%D0%BD%D0%B0%20%D0%B0%D0%BA%D0%BA%D0%B0%D1%83%D0%BD%D1%82%D0%B5%20agrAI."
          className="rounded-2xl border border-amber-300/35 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-500/30"
        >
          Продление (написать администратору)
        </a>
        <Link
          href="/login"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Войти в другой аккаунт
        </Link>
      </div>
    </section>
  );
}
