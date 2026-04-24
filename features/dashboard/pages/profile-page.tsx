"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { CalendarDays, Eye, EyeOff, UserRound } from "lucide-react";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);

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

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Заполните все поля пароля");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Новый пароль должен быть не короче 8 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Подтверждение пароля не совпадает");
      return;
    }

    setPasswordSaving(true);
    const response = await fetch("/api/profile/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword,
        newPassword,
      }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setPasswordSaving(false);
    if (!response.ok) {
      setPasswordError(data?.error ?? "Не удалось сменить пароль");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordSuccess("Пароль успешно обновлён");
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

      <form onSubmit={handlePasswordSubmit} className="mt-6">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl"
        >
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-white">Смена пароля</h3>
              <p className="text-sm text-zinc-400">Измените пароль для входа в ваш аккаунт</p>
            </div>
            <button
              type="button"
              onClick={() => setShowPasswords((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showPasswords ? "Скрыть" : "Показать"}
            </button>
          </div>

          <div className="grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Текущий пароль</span>
              <input
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Новый пароль</span>
              <input
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Подтвердите новый пароль</span>
              <input
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          </div>

          {passwordError ? <p className="mt-4 text-sm text-red-300">{passwordError}</p> : null}
          {passwordSuccess ? <p className="mt-4 text-sm text-emerald-300">{passwordSuccess}</p> : null}

          <button
            type="submit"
            disabled={passwordSaving}
            className="mt-6 w-full rounded-2xl border border-violet-300/30 bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60 sm:w-auto"
          >
            {passwordSaving ? "Сохранение…" : "Сменить пароль"}
          </button>
        </motion.section>
      </form>
    </>
  );
}
