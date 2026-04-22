"use client";

import { useCallback, useEffect, useState } from "react";
import { Construction, Loader2, Save } from "lucide-react";

type MaintenanceState = {
  enabled: boolean;
  message: string;
};

type DashboardBannerState = {
  enabled: boolean;
  message: string;
};

type ModelLockRow = {
  enabled: boolean;
  message: string;
};

const MODEL_LOCK_ITEMS: Array<{ id: string; title: string }> = [
  { id: "photo", title: "Генерация фото" },
  { id: "video", title: "Генерация видео" },
  { id: "voice", title: "Генерация голоса" },
  { id: "transcription", title: "Транскрибация" },
  { id: "video-enhance", title: "Улучшение качества" },
  { id: "motion-transfer", title: "Перенос движений" },
];

export function AdminMaintenanceClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [modelLocks, setModelLocks] = useState<Record<string, ModelLockRow>>({});

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [maintRes, bannerRes, modelLocksRes] = await Promise.all([
        fetch("/api/admin/maintenance"),
        fetch("/api/admin/dashboard-banner"),
        fetch("/api/admin/model-locks"),
      ]);
      const maintData = (await maintRes.json().catch(() => null)) as MaintenanceState & { error?: string };
      const bannerData = (await bannerRes.json().catch(() => null)) as DashboardBannerState & { error?: string };
      const modelLocksData = (await modelLocksRes.json().catch(() => null)) as
        | { locks?: Record<string, { enabled?: boolean; message?: string }>; error?: string }
        | null;
      if (!maintRes.ok) {
        setError(maintData?.error ?? "Не удалось загрузить настройки");
        return;
      }
      if (!bannerRes.ok) {
        setError(bannerData?.error ?? "Не удалось загрузить настройки плашки");
        return;
      }
      if (!modelLocksRes.ok) {
        setError(modelLocksData?.error ?? "Не удалось загрузить блокировки моделей");
        return;
      }
      setEnabled(Boolean(maintData.enabled));
      setMessage(typeof maintData.message === "string" ? maintData.message : "");
      setBannerEnabled(Boolean(bannerData.enabled));
      setBannerMessage(typeof bannerData.message === "string" ? bannerData.message : "");
      const rawLocks = modelLocksData?.locks ?? {};
      const nextLocks: Record<string, ModelLockRow> = {};
      for (const [modelId, row] of Object.entries(rawLocks)) {
        nextLocks[modelId] = {
          enabled: Boolean(row?.enabled),
          message: String(row?.message ?? "").trim(),
        };
      }
      setModelLocks(nextLocks);
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

  const saveBanner = async () => {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/dashboard-banner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: bannerEnabled, message: bannerMessage }),
      });
      const data = (await response.json().catch(() => null)) as DashboardBannerState & { error?: string };
      if (!response.ok) {
        setError(data?.error ?? "Не удалось сохранить плашку");
        return;
      }
      setBannerEnabled(Boolean(data.enabled));
      setBannerMessage(typeof data.message === "string" ? data.message : "");
    } finally {
      setSaving(false);
    }
  };

  const setModelLockField = (modelId: string, patch: Partial<ModelLockRow>) => {
    setModelLocks((prev) => ({
      ...prev,
      [modelId]: {
        enabled: Boolean(prev[modelId]?.enabled),
        message: String(prev[modelId]?.message ?? ""),
        ...patch,
      },
    }));
  };

  const saveModelLock = async (modelId: string) => {
    const current = modelLocks[modelId] ?? { enabled: false, message: "" };
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/model-locks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          enabled: current.enabled,
          message: current.message,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { locks?: Record<string, { enabled?: boolean; message?: string }>; error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "Не удалось сохранить блокировку модели");
        return;
      }
      const rawLocks = data?.locks ?? {};
      const nextLocks: Record<string, ModelLockRow> = {};
      for (const [id, row] of Object.entries(rawLocks)) {
        nextLocks[id] = {
          enabled: Boolean(row?.enabled),
          message: String(row?.message ?? "").trim(),
        };
      }
      setModelLocks(nextLocks);
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

      <div className="space-y-4 rounded-3xl border border-violet-400/20 bg-violet-500/5 p-6">
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:border-violet-400/25">
          <input
            type="checkbox"
            checked={bannerEnabled}
            onChange={(e) => setBannerEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-white/20 bg-black/50 text-violet-500 focus:ring-violet-400/40"
          />
          <span>
            <span className="font-medium text-white">Плашка в шапке кабинета</span>
            <span className="mt-1 block text-sm text-zinc-500">
              Отображается у пользователей в блоке «Текущий раздел».
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <label htmlFor="dashboard-banner-msg" className="text-sm font-medium text-zinc-300">
            Текст плашки
          </label>
          <textarea
            id="dashboard-banner-msg"
            value={bannerMessage}
            onChange={(e) => setBannerMessage(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/35"
            placeholder="Например: Важное объявление для пользователей."
          />
          <p className="text-xs text-zinc-600">До 4000 символов.</p>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void saveBanner()}
          className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/35 bg-violet-500/20 px-5 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить плашку
        </button>
      </div>

      <div className="space-y-4 rounded-3xl border border-cyan-400/20 bg-cyan-500/5 p-6">
        <div>
          <p className="text-base font-semibold text-white">Закрытие отдельных нейросетей</p>
          <p className="mt-1 text-sm text-zinc-400">
            Можно закрыть любую карточку у пользователей. На карточке появится полупрозрачный оверлей с вашим
            текстом, клик по ней будет заблокирован.
          </p>
        </div>

        <div className="space-y-3">
          {MODEL_LOCK_ITEMS.map((item) => {
            const row = modelLocks[item.id] ?? { enabled: false, message: "" };
            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => setModelLockField(item.id, { enabled: e.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-black/50 text-cyan-500 focus:ring-cyan-400/40"
                  />
                  <span>
                    <span className="font-medium text-white">{item.title}</span>
                    <span className="mt-1 block text-xs text-zinc-500">ID модели: {item.id}</span>
                  </span>
                </label>

                <div className="mt-3 space-y-2">
                  <label htmlFor={`model-lock-msg-${item.id}`} className="text-xs font-medium text-zinc-300">
                    Текст поверх карточки
                  </label>
                  <input
                    id={`model-lock-msg-${item.id}`}
                    type="text"
                    value={row.message}
                    onChange={(e) => setModelLockField(item.id, { message: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-400/35"
                    placeholder="Например: Обновление 5-10 мин"
                  />
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveModelLock(item.id)}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Сохранить
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
