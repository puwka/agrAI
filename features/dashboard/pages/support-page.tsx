import { Headset } from "lucide-react";

export function SupportPage() {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-2xl sm:p-8">
      <div className="mx-auto max-w-2xl space-y-5 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-300">
          <Headset className="h-3.5 w-3.5" />
          Поддержка
        </div>
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">Связь с поддержкой</h1>
        <p className="text-sm leading-7 text-zinc-300 sm:text-base">
          По любым вопросам, ошибкам или предложениям пишите в Telegram.
        </p>

        <a
          href="https://t.me/gptmlclub"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center rounded-2xl border border-violet-400/35 bg-violet-500/20 px-6 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/30"
        >
          @gptmlclub
        </a>
      </div>
    </section>
  );
}
