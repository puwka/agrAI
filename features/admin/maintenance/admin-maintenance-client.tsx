"use client";

import { useCallback, useEffect, useState } from "react";
import { Construction, Loader2, Save } from "lucide-react";

type MaintenanceState = {
  enabled: boolean;
  message: string;
};

export function AdminMaintenanceClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/admin/maintenance");
      const data = (await response.json().catch(() => null)) as MaintenanceState & { error?: string };
      if (!response.ok) {
        setError(data?.error ?? "Не удалось загрузить настройки");
        return;
      }
      setEnabled(Boolean(data.enabled));
      setMessage(typeof data.message === "string" ? data.message : "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceEnabled: enabled, maintenanceMessage: message }),
      });
      const data = (await response.json().catch(() => null)) as MaintenanceState & { error?: string };
      if (!response.ok) {
        setError(data?.error ?? "Не удалось сохранить");
        return;
      }
      setEnabled(Boolean(data.enabled));
      setMessage(typeof data.message === "string" ? data.message : "");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загрузка…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Технические работы</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Включите режим, чтобы пользователи в личном кабинете видели окно с вашим текстом и не могли
          создавать новые заявки на генерацию. Администраторы по-прежнему могут отправлять заявки.
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:border-amber-400/25">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-white/20 bg-black/50 text-amber-500 focus:ring-amber-400/40"
          />
          <span>
            <span className="flex items-center gap-2 font-medium text-white">
              <Construction className="h-4 w-4 text-amber-300" />
              Режим технических работ
            </span>
            <span className="mt-1 block text-sm text-zinc-500">
              Пока включено — у обычных пользователей блокируется только создание новых генераций.
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <label htmlFor="maintenance-msg" className="text-sm font-medium text-zinc-300">
            Текст в окне для пользователей
          </label>
          <textarea
            id="maintenance-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-amber-400/35"
            placeholder="Ведутся технические работы…"
          />
          <p className="text-xs text-zinc-600">До 4000 символов. Переносы строк сохраняются.</p>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/35 bg-amber-500/20 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить
        </button>
      </div>
    </div>
  );
}
