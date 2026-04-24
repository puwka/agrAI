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
          href="https://gptml.ru/story/3763-gptml-ai-bezlimitnyy-propusk-v-mir-neyrosetey"
          target="_blank"
          rel="noreferrer"
          className="rounded-2xl border border-amber-300/35 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-500/30"
        >
          Продление (написать администратору)
        </a>
      </div>
    </section>
  );
}
