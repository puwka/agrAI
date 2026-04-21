"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { CalendarDays, UserRound } from "lucide-react";
import { motion } from "framer-motion";

import { subscriptionSummaryForUser } from "../../../lib/subscription";
import { PageIntro } from "../components/page-intro";

type ProfileDto = {
  name: string;
  email: string;
  role: string;
  company: string | null;
  telegram: string | null;
  subscriptionUntil: string | null;
};

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [generationsCount, setGenerationsCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [profileRes, genRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/generations?limit=1&offset=0"),
      ]);

      if (!profileRes.ok) {
        setError("Не удалось загрузить профиль");
        return;
      }

      const profileData = (await profileRes.json()) as ProfileDto;
      setProfile(profileData);

      if (genRes.ok) {
        const genJson = (await genRes.json()) as { total?: number; items?: unknown[] };
        setGenerationsCount(typeof genJson.total === "number" ? genJson.total : genJson.items?.length ?? 0);
      }
    };

    void load();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) {
      return;
    }

    setSaving(true);
    setError(null);

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profile.name,
        company: profile.company,
        telegram: profile.telegram,
      }),
    });

    setSaving(false);

    if (!response.ok) {
      setError("Не удалось сохранить изменения");
    }
  };

  if (!profile) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-zinc-400">
        {error ?? "Загрузка профиля…"}
      </div>
    );
  }

  const subscriptionLine =
    profile.role === "ADMIN"
      ? "Не ограничена (администратор)"
      : subscriptionSummaryForUser(
          profile.role,
          profile.subscriptionUntil ? new Date(profile.subscriptionUntil) : null,
        ) ?? "—";

  const highlights = [
    { label: "Генераций", value: String(generationsCount) },
    { label: "Подписка", value: subscriptionLine },
  ];

  return (
    <>
      <PageIntro
        badge="Пользователь"
        title="Профиль"
        description="Здесь ваши личные данные и срок подписки."
        icon={UserRound}
        stats={highlights.map((item) => ({
          label: item.label,
          value: item.value,
        }))}
      />

      <form onSubmit={handleSubmit}>
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3 text-violet-200">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">Личные данные</h3>
              <p className="text-sm text-zinc-400">{profile.email}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Имя</span>
              <input
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Компания</span>
              <input
                value={profile.company ?? ""}
                onChange={(event) =>
                  setProfile({ ...profile, company: event.target.value || null })
                }
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
              />
            </label>
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-zinc-300">Telegram</span>
              <input
                value={profile.telegram ?? ""}
                onChange={(event) =>
                  setProfile({ ...profile, telegram: event.target.value || null })
                }
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
              />
            </label>
          </div>

          {profile.role !== "ADMIN" ? (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-300">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              <p className="leading-relaxed">{subscriptionLine}</p>
            </div>
          ) : null}

          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="mt-6 w-full rounded-2xl border border-violet-300/30 bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </motion.section>
      </form>
    </>
  );
}
