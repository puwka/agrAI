"use client";

import { useMemo, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  createdAt: string;
  generationsCount: number;
  apiKeysCount: number;
  restrictedUntil: string | null;
  restrictedReason: string | null;
  subscriptionUntil: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(dt);
}

function isActiveRestriction(until: string | null) {
  if (!until) return false;
  const dt = new Date(until);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() > Date.now();
}

function isActiveSubscription(until: string | null) {
  if (!until) return false;
  const dt = new Date(until);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() > Date.now();
}

export function AdminUsersTable({ initialRows }: { initialRows: AdminUserRow[] }) {
  const [rows, setRows] = useState<AdminUserRow[]>(initialRows);
  const [daysByUser, setDaysByUser] = useState<Record<string, string>>({});
  const [reasonByUser, setReasonByUser] = useState<Record<string, string>>({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"USER" | "ADMIN">("USER");
  const [newSubscriptionDays, setNewSubscriptionDays] = useState("30");
  const [creating, setCreating] = useState(false);
  const [subDaysByUser, setSubDaysByUser] = useState<Record<string, string>>({});

  const sorted = useMemo(() => rows, [rows]);

  const createUser = async () => {
    const name = newName.trim();
    const email = newEmail.trim().toLowerCase();
    const password = newPassword;
    if (!name || !email || !password) {
      setError("Заполните имя, email и пароль нового пользователя.");
      return;
    }
    if (password.length < 8) {
      setError("Пароль не короче 8 символов.");
      return;
    }

    setCreating(true);
    setError(null);

    const subDays = Number(newSubscriptionDays.trim());
    const payload: Record<string, unknown> = { name, email, password, role: newRole };
    if (newRole === "USER") {
      payload.subscriptionDays = Number.isFinite(subDays) ? subDays : 0;
    }

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as AdminUserRow | { error?: string } | null;
    setCreating(false);

    if (!response.ok) {
      setError((data && "error" in data ? data.error : null) ?? "Не удалось создать пользователя.");
      return;
    }

    if (!data || !("id" in data)) {
      setError("Некорректный ответ сервера.");
      return;
    }

    const row = data as AdminUserRow;
    setRows((current) => [
      {
        ...row,
        subscriptionUntil: row.subscriptionUntil ?? null,
      },
      ...current,
    ]);
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewRole("USER");
    setNewSubscriptionDays("30");
  };

  const applyRestriction = async (userId: string) => {
    const daysRaw = (daysByUser[userId] ?? "").trim();
    const days = Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0) {
      setError("Укажите количество дней (> 0).");
      return;
    }

    setBusyUserId(userId);
    setError(null);

    const reason = (reasonByUser[userId] ?? "").trim() || "Злоупотребление генерациями.";

    const response = await fetch(`/api/admin/users/${userId}/restriction`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days, reason }),
    });

    setBusyUserId(null);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось обновить ограничение.");
      return;
    }

    const updated = (await response.json()) as {
      id: string;
      restrictedUntil: string | Date | null;
      restrictedReason: string | null;
    };

    setRows((current) =>
      current.map((u) =>
        u.id === updated.id
          ? {
              ...u,
              restrictedUntil:
                typeof updated.restrictedUntil === "string"
                  ? updated.restrictedUntil
                  : updated.restrictedUntil
                    ? new Date(updated.restrictedUntil).toISOString()
                    : null,
              restrictedReason: updated.restrictedReason,
            }
          : u,
      ),
    );
  };

  const applySubscriptionDays = async (userId: string) => {
    const daysRaw = (subDaysByUser[userId] ?? "").trim();
    const days = Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0) {
      setError("Для подписки укажите количество дней (> 0).");
      return;
    }

    setBusyUserId(userId);
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/subscription`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });

    setBusyUserId(null);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось обновить подписку.");
      return;
    }

    const updated = (await response.json()) as {
      id: string;
      subscriptionUntil: string | Date | null;
    };

    setRows((current) =>
      current.map((u) =>
        u.id === updated.id
          ? {
              ...u,
              subscriptionUntil:
                typeof updated.subscriptionUntil === "string"
                  ? updated.subscriptionUntil
                  : updated.subscriptionUntil
                    ? new Date(updated.subscriptionUntil).toISOString()
                    : null,
            }
          : u,
      ),
    );
  };

  const clearSubscription = async (userId: string) => {
    setBusyUserId(userId);
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/subscription`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });

    setBusyUserId(null);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось сбросить подписку.");
      return;
    }

    const updated = (await response.json()) as { id: string; subscriptionUntil: null };
    setRows((current) =>
      current.map((u) => (u.id === updated.id ? { ...u, subscriptionUntil: null } : u)),
    );
  };

  const clearRestriction = async (userId: string) => {
    setBusyUserId(userId);
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/restriction`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });

    setBusyUserId(null);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось снять ограничение.");
      return;
    }

    const updated = (await response.json()) as { id: string; restrictedUntil: null; restrictedReason: null };
    setRows((current) =>
      current.map((u) =>
        u.id === updated.id ? { ...u, restrictedUntil: null, restrictedReason: null } : u,
      ),
    );
  };

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-violet-400/20 bg-violet-500/5 p-5">
        <h2 className="text-sm font-semibold text-white">Добавить пользователя</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Передайте человеку email и пароль для входа на странице «Вход».
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-zinc-400">Имя</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-zinc-400">Email</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Пароль (мин. 8)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
              autoComplete="new-password"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Роль</span>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "USER" | "ADMIN")}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40"
            >
              <option value="USER">Пользователь</option>
              <option value="ADMIN">Администратор</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Дней подписки (только USER)</span>
            <input
              value={newSubscriptionDays}
              onChange={(e) => setNewSubscriptionDays(e.target.value)}
              disabled={newRole === "ADMIN"}
              inputMode="numeric"
              placeholder="30"
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/40 disabled:cursor-not-allowed disabled:opacity-50"
              autoComplete="off"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => void createUser()}
          className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-violet-400/35 bg-violet-600/25 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-600/35 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Создать аккаунт
        </button>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="border-b border-white/10 text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Имя</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Роль</th>
              <th className="px-4 py-3 font-medium">Генерации</th>
              <th className="px-4 py-3 font-medium">Ключи</th>
              <th className="px-4 py-3 font-medium">Подписка</th>
              <th className="px-4 py-3 font-medium">Ограничение</th>
              <th className="px-4 py-3 font-medium">Действия</th>
              <th className="px-4 py-3 font-medium">Создан</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const active = isActiveRestriction(u.restrictedUntil);
              const subActive = isActiveSubscription(u.subscriptionUntil ?? null);
              const busy = busyUserId === u.id;
              const daysValue = daysByUser[u.id] ?? "";
              const reasonValue = reasonByUser[u.id] ?? (u.restrictedReason ?? "");
              const subDaysValue = subDaysByUser[u.id] ?? "";

              return (
                <tr key={u.id} className="border-b border-white/5 align-top last:border-0">
                  <td className="px-4 py-3 text-zinc-200">{u.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.email}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.role}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.generationsCount}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.apiKeysCount}</td>
                  <td className="px-4 py-3">
                    {u.role === "ADMIN" ? (
                      <span className="text-xs text-zinc-500">Не требуется</span>
                    ) : (
                      <div className="space-y-1">
                        <span
                          className={[
                            "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
                            subActive
                              ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                              : "border-white/10 bg-black/20 text-zinc-400",
                          ].join(" ")}
                        >
                          {subActive ? "Активна" : "Нет / истекла"}
                        </span>
                        <p className="text-xs text-zinc-500">до {formatDate(u.subscriptionUntil)}</p>
                        <div className="flex flex-wrap gap-2">
                          <input
                            value={subDaysValue}
                            onChange={(e) =>
                              setSubDaysByUser((s) => ({ ...s, [u.id]: e.target.value }))
                            }
                            placeholder="Дней"
                            inputMode="numeric"
                            disabled={busy}
                            className="w-[88px] rounded-2xl border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-white outline-none focus:border-violet-400/40"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void applySubscriptionDays(u.id)}
                            className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-2 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/15 disabled:opacity-60"
                          >
                            Продлить
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void clearSubscription(u.id)}
                            className="rounded-2xl border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 disabled:opacity-60"
                          >
                            Сбросить
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <span
                        className={[
                          "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
                          active
                            ? "border-red-400/25 bg-red-500/10 text-red-200"
                            : "border-white/10 bg-black/20 text-zinc-400",
                        ].join(" ")}
                      >
                        {active ? "Ограничен" : "Нет"}
                      </span>
                      <p className="text-xs text-zinc-500">до {formatDate(u.restrictedUntil)}</p>
                      {u.restrictedReason ? (
                        <p className="max-w-[260px] text-xs leading-5 text-zinc-400">
                          {u.restrictedReason}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="grid gap-2">
                      <div className="grid grid-cols-[120px_1fr] gap-2">
                        <input
                          value={daysValue}
                          onChange={(e) => setDaysByUser((s) => ({ ...s, [u.id]: e.target.value }))}
                          placeholder="Дней"
                          inputMode="numeric"
                          className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-violet-400/40"
                        />
                        <input
                          value={reasonValue}
                          onChange={(e) =>
                            setReasonByUser((s) => ({ ...s, [u.id]: e.target.value }))
                          }
                          placeholder="Причина (опц.)"
                          className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none focus:border-violet-400/40"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void applyRestriction(u.id)}
                          className="rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                        >
                          {busy ? "…" : "Ограничить"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void clearRestriction(u.id)}
                          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-60"
                        >
                          Снять
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDate(u.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

