import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-4 text-center text-zinc-100">
      <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">403</p>
      <h1 className="mt-3 text-2xl font-semibold text-white">Доступ запрещён</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-400">
        У вас нет прав для просмотра этой страницы.
      </p>
      <Link
        className="mt-8 rounded-2xl border border-violet-400/30 bg-violet-500/15 px-6 py-3 text-sm font-medium text-violet-100 transition hover:bg-violet-500/25"
        href="/dashboard"
      >
        В личный кабинет
      </Link>
    </div>
  );
}
