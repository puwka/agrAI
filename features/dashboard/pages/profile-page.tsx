"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { BellRing, ShieldCheck, SlidersHorizontal, Sparkles, UserRound } from "lucide-react";
import { motion } from "framer-motion";

import { PageIntro } from "../components/page-intro";

type ProfileDto = {
  name: string;
  email: string;
  company: string | null;
  telegram: string | null;
  notificationsEnabled: boolean;
  weeklyReportEnabled: boolean;
  defaultAspectRatio: string;
};

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={[
        "relative inline-flex h-7 w-12 items-center rounded-full border transition-all duration-300",
        checked
          ? "border-violet-400/40 bg-violet-500/25"
          : "border-white/10 bg-white/5",
      ].join(" ")}
    >
      <span
        className={[
          "h-5 w-5 rounded-full bg-white transition-transform duration-300",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [generationsCount, setGenerationsCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [profileRes, genRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/generations"),
      ]);

      if (!profileRes.ok) {
        setError("Не удалось загрузить профиль");
        return;
      }

      const profileData = (await profileRes.json()) as ProfileDto;
      setProfile(profileData);

      if (genRes.ok) {
        const gens = (await genRes.json()) as unknown[];
        setGenerationsCount(gens.length);
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
        notificationsEnabled: profile.notificationsEnabled,
        weeklyReportEnabled: profile.weeklyReportEnabled,
        defaultAspectRatio: profile.defaultAspectRatio,
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

  const highlights = [
    { label: "Генераций", value: String(generationsCount), icon: Sparkles },
    { label: "Уведомления", value: profile.notificationsEnabled ? "Вкл" : "Выкл", icon: BellRing },
    { label: "Формат по умолчанию", value: profile.defaultAspectRatio, icon: ShieldCheck },
  ];

  return (
    <>
      <PageIntro
        badge="Profile Settings"
        title="Профиль и настройки"
        description="Данные загружаются из базы и сохраняются на сервере."
        icon={UserRound}
        stats={highlights.map((item) => ({
          label: item.label,
          value: item.value,
        }))}
      />

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
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

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="mt-6 w-full rounded-2xl border border-violet-300/30 bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </motion.section>

          <div className="grid gap-6">
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl"
            >
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3 text-violet-200">
                  <SlidersHorizontal className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Предпочтения</h3>
                  <p className="text-sm text-zinc-400">Сохраняются в профиле</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300">
                      <BellRing className="h-4 w-4" />
                    </div>
                    <p className="text-sm leading-6 text-zinc-300">Email-уведомления</p>
                  </div>
                  <Toggle
                    checked={profile.notificationsEnabled}
                    onChange={() =>
                      setProfile({
                        ...profile,
                        notificationsEnabled: !profile.notificationsEnabled,
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300">
                      <BellRing className="h-4 w-4" />
                    </div>
                    <p className="text-sm leading-6 text-zinc-300">Еженедельный отчёт</p>
                  </div>
                  <Toggle
                    checked={profile.weeklyReportEnabled}
                    onChange={() =>
                      setProfile({
                        ...profile,
                        weeklyReportEnabled: !profile.weeklyReportEnabled,
                      })
                    }
                  />
                </div>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">Формат по умолчанию</span>
                  <select
                    value={profile.defaultAspectRatio}
                    onChange={(event) =>
                      setProfile({ ...profile, defaultAspectRatio: event.target.value })
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none"
                  >
                    <option value="16:9">16:9</option>
                    <option value="4:3">4:3</option>
                    <option value="1:1">1:1</option>
                    <option value="3:4">3:4</option>
                    <option value="9:16">9:16</option>
                  </select>
                </label>
              </div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl"
            >
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3 text-violet-200">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Безопасность</h3>
                  <p className="text-sm text-zinc-400">Сессия через Auth.js</p>
                </div>
              </div>
              <p className="text-sm leading-6 text-zinc-400">
                Пароль меняется отдельным потоком (не реализован в этой версии). Выход выполняется из
                бокового меню.
              </p>
            </motion.section>
          </div>
        </div>
      </form>
    </>
  );
}
