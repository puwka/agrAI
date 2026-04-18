"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";

type VoiceRow = {
  id: string;
  name: string;
  preview_audio_url: string;
};

export function AdminVoicePreviewsClient() {
  const [voices, setVoices] = useState<VoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/secret-voicer/voices");
      const data = (await res.json().catch(() => null)) as { voices?: VoiceRow[]; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Не удалось загрузить голоса");
        setVoices([]);
        return;
      }
      setVoices(data?.voices ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  const upload = async (voiceId: string, file: File) => {
    setError(null);
    setUploadingId(voiceId);
    try {
      const fd = new FormData();
      fd.append("voiceId", voiceId);
      fd.append("file", file);
      const res = await fetch("/api/admin/voice-previews", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Ошибка загрузки");
        return;
      }
      await loadVoices();
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Превью голосов</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Загрузите свой MP3 (или wav / m4a / aac / ogg / webm) для голоса — он будет проигрываться в каталоге у
          пользователей вместо стандартного превью.
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка каталога…
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#303030] bg-[#141414]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#303030] bg-[#1a1a1a] text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Голос</th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Текущее превью</th>
                <th className="px-4 py-3 font-medium">Файл</th>
              </tr>
            </thead>
            <tbody>
              {voices.map((v) => (
                <tr key={v.id} className="border-b border-[#303030] last:border-0">
                  <td className="px-4 py-3 font-medium text-white">{v.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{v.id}</td>
                  <td className="px-4 py-3">
                    {v.preview_audio_url ? (
                      <audio controls className="h-8 max-w-[220px]" src={v.preview_audio_url} preload="none" />
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-white/25 hover:bg-white/10">
                      <Upload className="h-3.5 w-3.5" />
                      {uploadingId === v.id ? "…" : "Загрузить"}
                      <input
                        type="file"
                        accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                        className="sr-only"
                        disabled={uploadingId !== null}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void upload(v.id, f);
                        }}
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && voices.length === 0 ? (
        <p className="text-sm text-zinc-500">Голоса не загрузились — проверьте доступ к Secret Voicer.</p>
      ) : null}
    </div>
  );
}
