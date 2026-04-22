"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { LayoutDashboard } from "lucide-react";

import { models } from "../config";
import { detectResultMediaKind } from "../lib";
import type { AspectRatio, MediaInputMode } from "../types";
import { ModelCard } from "../components/model-card";
import { PageIntro } from "../components/page-intro";
import { WorkspacePanel } from "../components/workspace-panel";
import type { VoiceOption } from "../components/voice-picker-modal";
import { useMaintenance } from "../maintenance-context";

type GenerationRow = {
  id: string;
  modelName: string;
  prompt: string;
  aspectRatio: string;
  status: string;
  resultUrl: string | null;
  resultMessage: string | null;
  inputMode?: string;
  referenceImageUrl?: string | null;
  createdAt: string;
};

export function DashboardHomePage({
  userName,
  isAdmin = false,
}: {
  userName: string;
  isAdmin?: boolean;
}) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  /** Промпт отдельно для каждой модели, чтобы при переключении фото/видео/голос не смешивался текст */
  const [promptsByModel, setPromptsByModel] = useState<Record<string, string>>({});
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [isLoading, setIsLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const [deliveryPending, setDeliveryPending] = useState(false);
  const [lastSubmittedId, setLastSubmittedId] = useState<string | null>(null);
  const [generations, setGenerations] = useState<GenerationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [generationSubmitError, setGenerationSubmitError] = useState<string | null>(null);
  const [mediaInputMode, setMediaInputMode] = useState<MediaInputMode>("TEXT");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [referenceUploadError, setReferenceUploadError] = useState<string | null>(null);
  const [transcriptionFileUrl, setTranscriptionFileUrl] = useState<string | null>(null);
  const [transcriptionUploading, setTranscriptionUploading] = useState(false);
  const [transcriptionUploadError, setTranscriptionUploadError] = useState<string | null>(null);
  const [transcriptionUploadProgress, setTranscriptionUploadProgress] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { enabled: maintenanceOn, refresh: refreshMaintenance } = useMaintenance();

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const activeModelsCount = models.filter((m) => !m.disabled).length;

  const prompt = selectedModelId ? promptsByModel[selectedModelId] ?? "" : "";

  const setPromptForSelectedModel = useCallback(
    (value: string) => {
      if (!selectedModelId) return;
      setPromptsByModel((prev) => ({ ...prev, [selectedModelId]: value }));
    },
    [selectedModelId],
  );

  const hasActiveGenerationInQueue = useMemo(() => {
    if (isAdmin) return false;
    return generations.some((g) => g.status === "PENDING" || g.status === "QUEUED");
  }, [generations, isAdmin]);

  const uploadReferenceImage = useCallback(async (file: File) => {
    setReferenceUploadError(null);
    setReferenceUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const response = await fetch("/api/generations/reference-upload", {
        method: "POST",
        body: fd,
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok) {
        setReferenceUploadError(data?.error ?? "Не удалось загрузить фото");
        setReferenceImageUrl(null);
        return;
      }
      if (data?.url) {
        setReferenceImageUrl(data.url);
      } else {
        setReferenceUploadError("Пустой ответ сервера");
        setReferenceImageUrl(null);
      }
    } finally {
      setReferenceUploading(false);
    }
  }, []);

  const uploadTranscriptionSource = useCallback(async (file: File) => {
    setTranscriptionUploadError(null);
    setTranscriptionUploadProgress(0);
    setTranscriptionUploading(true);
    try {
      const data = await new Promise<{ url?: string; error?: string; status: number }>((resolve, reject) => {
        const fd = new FormData();
        fd.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/generations/transcription-source-upload");
        xhr.responseType = "json";
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const p = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
            setTranscriptionUploadProgress(p);
          } else {
            setTranscriptionUploadProgress(null);
          }
        };
        xhr.onload = () => {
          const body = (xhr.response as { url?: string; error?: string } | null) ?? {};
          resolve({ ...body, status: xhr.status });
        };
        xhr.onerror = () => reject(new Error("NETWORK_ERROR"));
        xhr.onabort = () => reject(new Error("ABORTED"));
        xhr.send(fd);
      });

      if (data.status < 200 || data.status >= 300) {
        setTranscriptionUploadError(data.error ?? "Не удалось загрузить файл");
        setTranscriptionFileUrl(null);
        return;
      }
      if (data.url) {
        setTranscriptionUploadProgress(100);
        setTranscriptionFileUrl(data.url);
      } else {
        setTranscriptionUploadError("Пустой ответ сервера");
        setTranscriptionFileUrl(null);
      }
    } catch {
      setTranscriptionUploadError("Ошибка сети при загрузке");
      setTranscriptionFileUrl(null);
    } finally {
      setTranscriptionUploading(false);
    }
  }, []);

  const loadGenerations = useCallback(async () => {
    setLoadError(null);
    const response = await fetch("/api/generations?limit=10&offset=0");

    if (!response.ok) {
      setLoadError("Не удалось загрузить историю генераций");
      return;
    }

    const data = (await response.json()) as { items?: GenerationRow[]; total?: number };
    setGenerations(Array.isArray(data) ? (data as unknown as GenerationRow[]) : (data.items ?? []));
  }, []);

  useEffect(() => {
    void loadGenerations();
  }, [loadGenerations]);

  useEffect(() => {
    if (!maintenanceOn) {
      setGenerationSubmitError(null);
    }
  }, [maintenanceOn]);

  useEffect(() => {
    if (!lastSubmittedId) return;
    const row = generations.find((g) => g.id === lastSubmittedId);
    if (row?.status === "SUCCESS" && (row.resultUrl || row.resultMessage)) {
      setResultUrl(row.resultUrl ?? "");
      setResultMessage(row.resultMessage ?? "");
      setDeliveryPending(false);
    }
  }, [generations, lastSubmittedId]);

  useEffect(() => {
    const shouldPoll =
      deliveryPending ||
      (lastSubmittedId !== null &&
        generations.some((g) => g.id === lastSubmittedId && (g.status === "PENDING" || g.status === "QUEUED")));

    if (!shouldPoll) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void loadGenerations();
    }, 12_000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [deliveryPending, lastSubmittedId, generations, loadGenerations]);

  const handleSelectModel = (modelId: string) => {
    const found = models.find((m) => m.id === modelId);
    if (!found || found.disabled) {
      return;
    }
    setSelectedModelId(modelId);
    setIsLoading(false);
    setResultUrl("");
    setResultMessage("");
    setDeliveryPending(false);
    setLastSubmittedId(null);
    setVoiceError(null);
    setGenerationSubmitError(null);
    setMediaInputMode("TEXT");
    setReferenceImageUrl(null);
    setReferenceUploadError(null);
    setTranscriptionFileUrl(null);
    setTranscriptionUploadError(null);
    setTranscriptionUploadProgress(null);
    if (modelId !== "voice") {
      setSelectedVoice(null);
    }
  };

  const handleGenerate = async () => {
    if (!selectedModel || selectedModel.disabled) {
      return;
    }

    if (selectedModel.id === "voice" && !selectedVoice) {
      setVoiceError("Сначала выберите голос в каталоге.");
      return;
    }

    if (selectedModel.id === "photo" || selectedModel.id === "video") {
      if (mediaInputMode === "TEXT" && !prompt.trim()) {
        setGenerationSubmitError("Введите описание для режима «из текста».");
        return;
      }
      if (mediaInputMode === "IMAGE_REF") {
        if (referenceUploading) {
          return;
        }
        if (!referenceImageUrl) {
          setGenerationSubmitError("Загрузите исходное фото для режима «из фото».");
          return;
        }
      }
    }

    if (selectedModel.id === "transcription") {
      if (transcriptionUploading) {
        return;
      }
      const link = prompt.trim();
      let linkOk = false;
      if (link) {
        try {
          const u = new URL(link);
          linkOk = u.protocol === "http:" || u.protocol === "https:";
        } catch {
          linkOk = false;
        }
      }
      if (!transcriptionFileUrl?.trim() && !linkOk) {
        setGenerationSubmitError("Укажите ссылку на видео/аудио или загрузите файл.");
        return;
      }
    }

    setIsLoading(true);
    setResultUrl("");
    setResultMessage("");
    setDeliveryPending(false);
    setVoiceError(null);
    setGenerationSubmitError(null);

    const mediaModeSuffix =
      selectedModel.id === "photo"
        ? mediaInputMode === "TEXT"
          ? "Из текста в фото"
          : "Из фото в фото"
        : selectedModel.id === "video"
          ? mediaInputMode === "TEXT"
            ? "Из текста в видео"
            : "Из фото в видео"
          : "";

    const displayModelName =
      selectedModel.id === "voice" && selectedVoice
        ? `${selectedModel.name} • ${selectedVoice.name}`
        : mediaModeSuffix
          ? `${selectedModel.name} • ${mediaModeSuffix}`
          : selectedModel.name;

    const response = await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: selectedModel.id,
        modelName: displayModelName,
        prompt,
        aspectRatio,
        ...(selectedModel.id === "voice" && selectedVoice
          ? { voiceId: selectedVoice.id, voiceName: selectedVoice.name }
          : {}),
        ...((selectedModel.id === "photo" || selectedModel.id === "video") && {
          inputMode: mediaInputMode,
          referenceImageUrl: mediaInputMode === "IMAGE_REF" ? referenceImageUrl : null,
        }),
        ...(selectedModel.id === "transcription" && {
          referenceImageUrl: transcriptionFileUrl || null,
        }),
      }),
    });

    if (!response.ok) {
      const raw = (await response.json().catch(() => null)) as {
        error?: string;
        maintenanceMessage?: string;
      } | null;
      if (response.status === 503) {
        setGenerationSubmitError(
          raw?.maintenanceMessage?.trim() || raw?.error || "Технические работы. Попробуйте позже.",
        );
        void refreshMaintenance();
      } else if (response.status === 409) {
        setGenerationSubmitError(raw?.error ?? "Уже есть заявка в работе.");
        void loadGenerations();
      }
      setIsLoading(false);
      return;
    }

    const created = (await response.json()) as GenerationRow;
    setLastSubmittedId(created.id);
    setDeliveryPending(true);
    setResultUrl("");
    setResultMessage("");
    setMediaInputMode("TEXT");
    setReferenceImageUrl(null);
    setReferenceUploadError(null);
    setTranscriptionFileUrl(null);
    setTranscriptionUploadError(null);
    setTranscriptionUploadProgress(null);
    setIsLoading(false);
    void loadGenerations();
  };

  return (
    <>
      <PageIntro
        badge="Личный кабинет"
        title={`Добро пожаловать, ${userName}!`}
        description={
          <>
            Безлимитные генерации в лучших моделях: фото, видео, озвучка и транскрибация. Сервис от{" "}
            <a
              href="https://gptml.ru"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-violet-300 transition hover:text-violet-200"
            >
              GPTML.RU
            </a>
            .
          </>
        }
        icon={LayoutDashboard}
        stats={[
          { label: "Активных моделей", value: String(activeModelsCount) },
          { label: "Статус", value: selectedModel ? "Модель выбрана" : "Ожидание выбора" },
          { label: "Формат", value: aspectRatio },
        ]}
      />

      {loadError && (
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </p>
      )}

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
        className="space-y-5"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-white">Выберите нейросеть</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Выберите подходящую модель для генерации и настройте рабочую зону под нужный формат.
            </p>
          </div>
          <div className="hidden rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-400 md:block">
            {activeModelsCount} модели доступны
          </div>
        </div>

        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2">
          {models.map((model, index) => (
            <motion.div
              key={model.id}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 + index * 0.05 }}
              className="flex h-full"
            >
              <ModelCard
                model={model}
                isSelected={selectedModelId === model.id}
                onSelect={() => handleSelectModel(model.id)}
              />
            </motion.div>
          ))}
        </div>
      </motion.section>

      <WorkspacePanel
        selectedModel={selectedModel}
        prompt={prompt}
        aspectRatio={aspectRatio}
        isLoading={isLoading}
        deliveryPending={deliveryPending}
        resultUrl={resultUrl}
        resultMessage={resultMessage}
        selectedVoice={selectedVoice}
        voiceError={voiceError}
        generationSubmitError={generationSubmitError}
        queueBlocked={hasActiveGenerationInQueue || (!isAdmin && deliveryPending)}
        showMediaInputModes={selectedModel?.id === "photo" || selectedModel?.id === "video"}
        mediaInputMode={mediaInputMode}
        onMediaInputModeChange={(mode) => {
          setMediaInputMode(mode);
          setGenerationSubmitError(null);
          if (mode === "TEXT") {
            setReferenceImageUrl(null);
            setReferenceUploadError(null);
          }
        }}
        referenceImageUrl={referenceImageUrl}
        referenceUploading={referenceUploading}
        referenceUploadError={referenceUploadError}
        onReferenceFileSelected={(file) => {
          void uploadReferenceImage(file);
        }}
        onClearReference={() => {
          setReferenceImageUrl(null);
          setReferenceUploadError(null);
        }}
        onPromptChange={setPromptForSelectedModel}
        onAspectRatioChange={setAspectRatio}
        onVoiceChange={(voice) => {
          setSelectedVoice(voice);
          setVoiceError(null);
        }}
        onGenerate={handleGenerate}
        previewDownloadGenerationId={
          lastSubmittedId && !deliveryPending && (resultUrl.trim() || resultMessage.trim())
            ? lastSubmittedId
            : null
        }
        transcriptionFileUrl={transcriptionFileUrl}
        transcriptionUploading={transcriptionUploading}
        transcriptionUploadError={transcriptionUploadError}
        transcriptionUploadProgress={transcriptionUploadProgress}
        onTranscriptionFileSelected={(file) => {
          void uploadTranscriptionSource(file);
        }}
        onClearTranscriptionFile={() => {
          setTranscriptionFileUrl(null);
          setTranscriptionUploadError(null);
          setTranscriptionUploadProgress(null);
        }}
      />

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl"
      >
        <h3 className="text-lg font-semibold text-white">Мои генерации</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Показаны 10 последних заявок. Полная история, поиск и постраничный просмотр — в разделе «Логи».
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {generations.length === 0 ? (
            <p className="text-sm text-zinc-500">Пока нет генераций — создайте первую выше.</p>
          ) : (
            generations.map((item) => {
              const ready = item.status === "SUCCESS" && (item.resultUrl || item.resultMessage);
              const failed = item.status === "ERROR";
              const mediaKind = item.resultUrl ? detectResultMediaKind(item.resultUrl) : "image";
              return (
                <div key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  {ready && item.resultUrl ? (
                    mediaKind === "video" ? (
                      <video
                        src={item.resultUrl}
                        controls
                        playsInline
                        className="aspect-video w-full bg-black object-contain"
                      />
                    ) : mediaKind === "audio" ? (
                      <div className="flex aspect-video w-full items-center justify-center bg-black/50 px-4 py-6">
                        <audio
                          src={item.resultUrl}
                          controls
                          className="w-full max-w-md"
                          preload="metadata"
                        />
                      </div>
                    ) : (
                      <img
                        src={item.resultUrl}
                        alt={item.modelName}
                        className="aspect-video w-full object-cover"
                      />
                    )
                  ) : ready && item.resultMessage ? (
                    <div className="flex aspect-video w-full flex-col justify-center gap-2 bg-gradient-to-b from-violet-500/15 to-black/60 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-violet-200/90">
                        Ответ системы
                      </p>
                      <p className="line-clamp-6 text-sm leading-relaxed text-zinc-100">
                        {item.resultMessage}
                      </p>
                    </div>
                  ) : failed ? (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-red-500/10 px-4 text-center">
                      <p className="text-sm font-medium text-red-200">Ошибка</p>
                      <p className="text-xs text-zinc-400">Попробуйте создать заявку снова</p>
                    </div>
                  ) : (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-amber-500/10 to-black/50 px-4 text-center">
                      <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-300/40 border-t-amber-200" />
                      <p className="text-xs leading-5 text-zinc-300">
                        Ожидаем результат (обычно 5–15 минут)
                      </p>
                    </div>
                  )}
                  <div className="space-y-2 p-3">
                    <p className="text-sm font-medium text-white">{item.modelName}</p>
                    <p className="line-clamp-2 text-xs text-zinc-400">{item.prompt || "—"}</p>
                    {ready && (
                      <a
                        href={`/api/generations/${item.id}/download`}
                        className="inline-flex text-xs font-semibold text-violet-300 hover:text-violet-200"
                      >
                        {item.resultUrl ? "Скачать файл" : "Скачать ответ (.txt)"}
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.section>
    </>
  );
}
