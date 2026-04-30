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
import { MAX_ACT_TWO_VIDEO_UPLOAD_LABEL, MAX_TOPAZ_UPLOAD_LABEL } from "../../../lib/transcription-limits";

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

const MAX_RUNWAY_PROMPT_LEN = 1000;
const MAX_VOICE_PROMPT_LEN = 4000;

function normalizeApiErrorText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return value.message.trim();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const preferred = [
      obj.detail,
      obj.details,
      obj.error,
      obj.message,
      obj.hint,
      obj.code,
    ];
    for (const item of preferred) {
      const normalized = normalizeApiErrorText(item);
      if (normalized) return normalized;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  }
  return String(value).trim();
}

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
  const [enhanceFileUrl, setEnhanceFileUrl] = useState<string | null>(null);
  const [enhanceUploading, setEnhanceUploading] = useState(false);
  const [enhanceUploadError, setEnhanceUploadError] = useState<string | null>(null);
  const [enhanceUploadProgress, setEnhanceUploadProgress] = useState<number | null>(null);
  const [enhanceQuality, setEnhanceQuality] = useState<"original" | "2x" | "4x">("original");
  const [enhanceFps, setEnhanceFps] = useState<"24" | "25" | "30" | "45" | "50" | "60">("60");
  const [photoModelVariant, setPhotoModelVariant] = useState<"nana2" | "nana-pro" | "sora-image">("nana2");
  const [videoModelVariant, setVideoModelVariant] = useState<"veo-3.1-relax" | "runway-gen-4">("veo-3.1-relax");
  const [runwayDurationSec, setRunwayDurationSec] = useState<5 | 10>(5);
  const [motionCharacterUrl, setMotionCharacterUrl] = useState<string | null>(null);
  const [motionCharacterUploading, setMotionCharacterUploading] = useState(false);
  const [motionCharacterUploadError, setMotionCharacterUploadError] = useState<string | null>(null);
  const [motionVideoUrl, setMotionVideoUrl] = useState<string | null>(null);
  const [motionVideoDurationSec, setMotionVideoDurationSec] = useState<number | null>(null);
  const [motionVideoUploading, setMotionVideoUploading] = useState(false);
  const [motionVideoUploadError, setMotionVideoUploadError] = useState<string | null>(null);
  const [motionVideoUploadProgress, setMotionVideoUploadProgress] = useState<number | null>(null);
  const [modelLocks, setModelLocks] = useState<Record<string, { enabled: boolean; message: string }>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { enabled: maintenanceOn, refresh: refreshMaintenance } = useMaintenance();

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const activeModelsCount = models.filter((m) => !m.disabled).length;

  const prompt = selectedModelId ? promptsByModel[selectedModelId] ?? "" : "";

  const setPromptForSelectedModel = useCallback(
    (value: string) => {
      if (!selectedModelId) return;
      const nextValue =
        selectedModelId === "video" && videoModelVariant === "runway-gen-4"
          ? value.slice(0, MAX_RUNWAY_PROMPT_LEN)
          : selectedModelId === "voice"
            ? value.slice(0, MAX_VOICE_PROMPT_LEN)
            : value;
      setPromptsByModel((prev) => ({ ...prev, [selectedModelId]: nextValue }));
    },
    [selectedModelId, videoModelVariant],
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

  const uploadEnhanceSource = useCallback(async (file: File) => {
    setEnhanceUploadError(null);
    setEnhanceUploadProgress(0);
    setEnhanceUploading(true);
    try {
      const data = await new Promise<{ url?: string; error?: string; status: number }>((resolve, reject) => {
        const fd = new FormData();
        fd.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/generations/video-enhance-source-upload");
        xhr.responseType = "json";
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const p = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
            setEnhanceUploadProgress(p);
          } else {
            setEnhanceUploadProgress(null);
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
        setEnhanceUploadError(data.error ?? "Не удалось загрузить видео");
        setEnhanceFileUrl(null);
        return;
      }
      if (data.url) {
        setEnhanceUploadProgress(100);
        setEnhanceFileUrl(data.url);
      } else {
        setEnhanceUploadError("Пустой ответ сервера");
        setEnhanceFileUrl(null);
      }
    } catch {
      setEnhanceUploadError("Ошибка сети при загрузке");
      setEnhanceFileUrl(null);
    } finally {
      setEnhanceUploading(false);
    }
  }, []);

  const readVideoDurationSec = useCallback(async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    try {
      const sec = await new Promise<number>((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => resolve(v.duration);
        v.onerror = () => reject(new Error("DURATION_READ_FAILED"));
        v.src = objectUrl;
      });
      return sec;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, []);

  const uploadMotionVideo = useCallback(async (file: File) => {
    setMotionVideoUploadError(null);
    setMotionVideoUploadProgress(0);
    setMotionVideoUploading(true);
    try {
      const durationSec = await readVideoDurationSec(file);
      if (!Number.isFinite(durationSec) || durationSec < 3 || durationSec > 30) {
        setMotionVideoUploadError("Видео должно быть от 3 до 30 секунд.");
        setMotionVideoUrl(null);
        setMotionVideoDurationSec(null);
        return;
      }
      const data = await new Promise<{ url?: string; error?: string; status: number }>((resolve, reject) => {
        const fd = new FormData();
        fd.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/generations/motion-video-upload");
        xhr.responseType = "json";
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const p = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
            setMotionVideoUploadProgress(p);
          } else {
            setMotionVideoUploadProgress(null);
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
        setMotionVideoUploadError(data.error ?? "Не удалось загрузить видео");
        setMotionVideoUrl(null);
        setMotionVideoDurationSec(null);
        return;
      }
      if (data.url) {
        setMotionVideoUploadProgress(100);
        setMotionVideoUrl(data.url);
        setMotionVideoDurationSec(Math.round(durationSec));
      } else {
        setMotionVideoUploadError("Пустой ответ сервера");
        setMotionVideoUrl(null);
        setMotionVideoDurationSec(null);
      }
    } catch {
      setMotionVideoUploadError("Ошибка сети при загрузке видео");
      setMotionVideoUrl(null);
      setMotionVideoDurationSec(null);
    } finally {
      setMotionVideoUploading(false);
    }
  }, [readVideoDurationSec]);

  const uploadMotionCharacter = useCallback(async (file: File) => {
    setMotionCharacterUploadError(null);
    setMotionCharacterUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const response = await fetch("/api/generations/reference-upload", {
        method: "POST",
        body: fd,
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok) {
        setMotionCharacterUploadError(data?.error ?? "Не удалось загрузить персонажа");
        setMotionCharacterUrl(null);
        return;
      }
      if (data?.url) {
        setMotionCharacterUrl(data.url);
      } else {
        setMotionCharacterUploadError("Пустой ответ сервера");
        setMotionCharacterUrl(null);
      }
    } finally {
      setMotionCharacterUploading(false);
    }
  }, []);

  const loadGenerations = useCallback(async () => {
    setLoadError(null);
    const response = await fetch("/api/generations?limit=10&offset=0&brief=1");

    if (!response.ok) {
      setLoadError("Не удалось загрузить историю генераций");
      return;
    }

    const data = (await response.json()) as { items?: GenerationRow[]; total?: number };
    setGenerations(Array.isArray(data) ? (data as unknown as GenerationRow[]) : (data.items ?? []));
  }, []);

  const loadModelLocks = useCallback(async () => {
    const response = await fetch("/api/model-locks");
    if (!response.ok) return;
    const data = (await response.json().catch(() => null)) as
      | { locks?: Record<string, { enabled?: boolean; message?: string }> }
      | null;
    const raw = data?.locks ?? {};
    const next: Record<string, { enabled: boolean; message: string }> = {};
    for (const [k, v] of Object.entries(raw)) {
      next[k] = {
        enabled: Boolean(v?.enabled),
        message: String(v?.message ?? "").trim(),
      };
    }
    setModelLocks(next);
  }, []);

  useEffect(() => {
    void loadGenerations();
  }, [loadGenerations]);

  useEffect(() => {
    void loadModelLocks();
  }, [loadModelLocks]);

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
    setEnhanceFileUrl(null);
    setEnhanceUploadError(null);
    setEnhanceUploadProgress(null);
    setEnhanceQuality("original");
    setEnhanceFps("60");
    setVideoModelVariant("veo-3.1-relax");
    setRunwayDurationSec(5);
    setMotionCharacterUrl(null);
    setMotionCharacterUploading(false);
    setMotionCharacterUploadError(null);
    setMotionVideoUrl(null);
    setMotionVideoDurationSec(null);
    setMotionVideoUploadError(null);
    setMotionVideoUploadProgress(null);
    if (modelId !== "photo") {
      setPhotoModelVariant("nana2");
    }
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
      if (selectedModel.id === "video" && videoModelVariant === "runway-gen-4" && prompt.length > MAX_RUNWAY_PROMPT_LEN) {
        setGenerationSubmitError(`Для Runway Gen-4 максимум ${MAX_RUNWAY_PROMPT_LEN} символов в промпте.`);
        return;
      }
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

    if (selectedModel.id === "voice" && prompt.length > MAX_VOICE_PROMPT_LEN) {
      setGenerationSubmitError(`Текст для озвучки не длиннее ${MAX_VOICE_PROMPT_LEN} символов.`);
      return;
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

    if (selectedModel.id === "video-enhance") {
      if (enhanceUploading) return;
      if (!enhanceFileUrl?.trim()) {
        setGenerationSubmitError("Загрузите видео для улучшения.");
        return;
      }
    }

    if (selectedModel.id === "motion-transfer") {
      if (motionCharacterUploading || motionVideoUploading) return;
      if (!motionCharacterUrl?.trim()) {
        setGenerationSubmitError("Загрузите персонажа.");
        return;
      }
      if (!motionVideoUrl?.trim()) {
        setGenerationSubmitError("Загрузите видео для переноса движений.");
        return;
      }
      if (!motionVideoDurationSec || motionVideoDurationSec < 3 || motionVideoDurationSec > 30) {
        setGenerationSubmitError("Видео должно быть от 3 до 30 секунд.");
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
        : selectedModel.id === "photo"
          ? `${selectedModel.name} • ${
              photoModelVariant === "nana-pro"
                ? "Nana Banana Pro"
                : photoModelVariant === "sora-image"
                  ? "Sora image"
                  : "Nana Banana 2"
            }`
          : selectedModel.id === "video"
            ? `${selectedModel.name} • ${videoModelVariant === "runway-gen-4" ? "Runway Gen-4" : "Veo 3.1 Relax"}`
        : mediaModeSuffix
          ? `${selectedModel.name} • ${mediaModeSuffix}`
          : selectedModel.name;

    try {
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
            ...(selectedModel.id === "video" && videoModelVariant === "runway-gen-4"
              ? { runwayDurationSec }
              : {}),
          }),
          ...(selectedModel.id === "transcription" && {
            referenceImageUrl: transcriptionFileUrl || null,
          }),
          ...(selectedModel.id === "video-enhance" && {
            referenceImageUrl: enhanceFileUrl || null,
            enhanceQuality,
            enhanceFps,
          }),
          ...(selectedModel.id === "motion-transfer" && {
            referenceImageUrl: motionCharacterUrl || null,
            motionVideoUrl: motionVideoUrl || null,
            motionVideoDurationSec: motionVideoDurationSec ?? null,
          }),
        }),
      });

      if (!response.ok) {
        const raw = (await response.json().catch(() => null)) as
          | {
              error?: unknown;
              maintenanceMessage?: unknown;
              detail?: unknown;
              details?: unknown;
              message?: unknown;
            }
          | null;
        const errorText =
          normalizeApiErrorText(raw?.maintenanceMessage) ||
          normalizeApiErrorText(raw?.detail) ||
          normalizeApiErrorText(raw?.details) ||
          normalizeApiErrorText(raw?.error) ||
          normalizeApiErrorText(raw?.message);
        if (response.status === 503) {
          setGenerationSubmitError(errorText || "Технические работы. Попробуйте позже.");
          void refreshMaintenance();
        } else if (response.status === 409) {
          setGenerationSubmitError(errorText || "Уже есть заявка в работе.");
          void loadGenerations();
        } else {
          setGenerationSubmitError(errorText || "Не удалось отправить заявку. Попробуйте ещё раз.");
        }
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
      setEnhanceFileUrl(null);
      setEnhanceUploadError(null);
      setEnhanceUploadProgress(null);
      setMotionCharacterUrl(null);
      setMotionCharacterUploading(false);
      setMotionCharacterUploadError(null);
      setMotionVideoUrl(null);
      setMotionVideoDurationSec(null);
      setMotionVideoUploadError(null);
      setMotionVideoUploadProgress(null);
      void loadGenerations();
    } catch {
      setGenerationSubmitError("Ошибка сети при отправке заявки. Попробуйте ещё раз.");
    } finally {
      setIsLoading(false);
    }
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
                lockedMessage={modelLocks[model.id]?.enabled ? modelLocks[model.id]?.message : null}
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
        enhanceFileUrl={enhanceFileUrl}
        enhanceUploading={enhanceUploading}
        enhanceUploadError={enhanceUploadError}
        enhanceUploadProgress={enhanceUploadProgress}
        enhanceMaxLabel={MAX_TOPAZ_UPLOAD_LABEL}
        enhanceQuality={enhanceQuality}
        enhanceFps={enhanceFps}
        onEnhanceFileSelected={(file) => {
          void uploadEnhanceSource(file);
        }}
        onEnhanceFileClear={() => {
          setEnhanceFileUrl(null);
          setEnhanceUploadError(null);
          setEnhanceUploadProgress(null);
        }}
        onEnhanceQualityChange={setEnhanceQuality}
        onEnhanceFpsChange={setEnhanceFps}
        photoModelVariant={photoModelVariant}
        onPhotoModelVariantChange={(v) => {
          setPhotoModelVariant(v);
          if (v === "sora-image") {
            if (aspectRatio !== "3:2" && aspectRatio !== "1:1" && aspectRatio !== "2:3") {
              setAspectRatio("1:1");
            }
          } else if (aspectRatio === "3:2" || aspectRatio === "2:3") {
            setAspectRatio("16:9");
          }
        }}
        videoModelVariant={videoModelVariant}
        onVideoModelVariantChange={(v) => {
          setVideoModelVariant(v);
          if (v === "runway-gen-4") {
            setPromptsByModel((prev) => {
              const current = prev.video ?? "";
              if (current.length <= MAX_RUNWAY_PROMPT_LEN) return prev;
              return { ...prev, video: current.slice(0, MAX_RUNWAY_PROMPT_LEN) };
            });
            setRunwayDurationSec((prev) => (prev === 10 ? 10 : 5));
            if (
              aspectRatio !== "21:9" &&
              aspectRatio !== "16:9" &&
              aspectRatio !== "4:3" &&
              aspectRatio !== "1:1" &&
              aspectRatio !== "3:4" &&
              aspectRatio !== "9:16"
            ) {
              setAspectRatio("1:1");
            }
          } else if (aspectRatio === "21:9") {
            setAspectRatio("16:9");
          }
        }}
        runwayDurationSec={runwayDurationSec}
        onRunwayDurationChange={setRunwayDurationSec}
        motionCharacterUrl={motionCharacterUrl}
        motionCharacterUploading={motionCharacterUploading}
        motionCharacterUploadError={motionCharacterUploadError}
        motionVideoUrl={motionVideoUrl}
        motionVideoDurationSec={motionVideoDurationSec}
        motionVideoUploading={motionVideoUploading}
        motionVideoUploadError={motionVideoUploadError}
        motionVideoUploadProgress={motionVideoUploadProgress}
        motionVideoMaxLabel={MAX_ACT_TWO_VIDEO_UPLOAD_LABEL}
        onMotionCharacterSelected={(file) => {
          void uploadMotionCharacter(file);
        }}
        onMotionCharacterClear={() => {
          setMotionCharacterUrl(null);
          setMotionCharacterUploadError(null);
        }}
        onMotionVideoSelected={(file) => {
          void uploadMotionVideo(file);
        }}
        onMotionVideoClear={() => {
          setMotionVideoUrl(null);
          setMotionVideoDurationSec(null);
          setMotionVideoUploadError(null);
          setMotionVideoUploadProgress(null);
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
              const inlineResultSrc =
                ready && item.resultUrl ? `/api/generations/${item.id}/download?inline=1` : "";
              return (
                <div key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  {ready && item.resultUrl ? (
                    mediaKind === "video" ? (
                      <video
                        src={inlineResultSrc}
                        controls
                        playsInline
                        preload="none"
                        className="aspect-video w-full bg-black object-contain"
                      />
                    ) : mediaKind === "audio" ? (
                      <div className="flex aspect-video w-full items-center justify-center bg-black/50 px-4 py-6">
                        <audio
                          src={inlineResultSrc}
                          controls
                          className="w-full max-w-md"
                          preload="metadata"
                        />
                      </div>
                    ) : (
                      <img
                        src={inlineResultSrc}
                        alt={item.modelName}
                        loading="lazy"
                        decoding="async"
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
