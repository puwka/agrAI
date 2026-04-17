import Link from "next/link";

import { db } from "../../lib/db";

export default async function AdminDashboardPage() {
  const [userCount, generationCount, recentUsers, recentGenerations] = await Promise.all([
    db.user.count(),
    db.generation.count(),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    db.generation.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-white">Панель администратора</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Доступ ко всем пользователям, генерациям, промптам и результатам.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="text-sm text-zinc-500">Пользователей</p>
          <p className="mt-2 text-3xl font-semibold text-white">{userCount}</p>
          <Link className="mt-4 inline-block text-sm text-violet-300 hover:underline" href="/admin/users">
            Все пользователи →
          </Link>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="text-sm text-zinc-500">Генераций</p>
          <p className="mt-2 text-3xl font-semibold text-white">{generationCount}</p>
          <Link
            className="mt-4 inline-block text-sm text-violet-300 hover:underline"
            href="/admin/generations"
          >
            Все генерации →
          </Link>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold text-white">Последние пользователи</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {recentUsers.map((u: any) => (
              <li key={u.id} className="flex justify-between gap-4 border-b border-white/5 pb-3 last:border-0">
                <span className="text-zinc-300">{u.name}</span>
                <span className="truncate text-zinc-500">{u.email}</span>
                <span className="text-zinc-500">{u.role}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold text-white">Последние генерации</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {recentGenerations.map((g: any) => (
              <li key={g.id} className="border-b border-white/5 pb-3 last:border-0">
                <p className="text-zinc-300">{g.user.name}</p>
                <p className="mt-1 line-clamp-2 text-zinc-500">{g.prompt}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
