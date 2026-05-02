"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  FileImage,
  Mic,
  PanelsTopLeft,
  Sparkles,
  Type,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import { MAX_TRANSCRIPTION_UPLOAD_LABEL } from "../../../lib/transcription-limits";
import type { AspectRatio, MediaInputMode, Model } from "../types";
import { useMaintenance } from "../maintenance-context";
import { ResultPreview } from "./result-preview";
import { VoicePickerModal, type VoiceOption } from "./voice-picker-modal";

type WorkspacePanelProps = {
  selectedModel: Model | null;
  prompt: string;
  aspectRatio: AspectRatio;
  isLoading: boolean;
  deliveryPending: boolean;
  resultUrl: string;
  resultMessage: string;
  selectedVoice: VoiceOption | null;
  voiceError: string | null;
  /** Ошибка отправки заявки (например 503 техработы) */
  generationSubmitError: string | null;
  /** У пользователя уже есть заявка PENDING/QUEUED (или ожидается подтверждение после отправки) */
  queueBlocked: boolean;
  showMediaInputModes: boolean;
  mediaInputMode: MediaInputMode;
  onMediaInputModeChange: (mode: MediaInputMode) => void;
  referenceImageUrl: string | null;
  referenceUploading: boolean;
  referenceUploadError: string | null;
  onReferenceFileSelected: (file: File) => void;
  onClearReference: () => void;
  onPromptChange: (value: string) => void;
  onAspectRatioChange: (value: AspectRatio) => void;
  onVoiceChange: (voice: VoiceOption | null) => void;
  onGenerate: () => void;
  /** Для кнопки «Скачать» в превью (после готовности текущей заявки) */
  previewDownloadGenerationId: string | null;
  /** Транскрибация: загруженный источник (URL в storage / локально) */
  transcriptionFileUrl: string | null;
  transcriptionUploading: boolean;
  transcriptionUploadError: string | null;
  transcriptionUploadProgress: number | null;
  onTranscriptionFileSelected: (file: File) => void;
  onClearTranscriptionFile: () => void;
  enhanceFileUrl: string | null;
  enhanceUploading: boolean;
  enhanceUploadError: string | null;
  enhanceUploadProgress: number | null;
  enhanceMaxLabel: string;
  enhanceQuality: "original" | "2x" | "4x";
  enhanceFps: "24" | "25" | "30" | "45" | "50" | "60";
  onEnhanceFileSelected: (file: File) => void;
  onEnhanceFileClear: () => void;
  onEnhanceQualityChange: (v: "original" | "2x" | "4x") => void;
  onEnhanceFpsChange: (v: "24" | "25" | "30" | "45" | "50" | "60") => void;
  photoModelVariant: "nana2" | "nana-pro" | "sora-image";
  onPhotoModelVariantChange: (v: "nana2" | "nana-pro" | "sora-image") => void;
  videoModelVariant: "veo-3.1-relax" | "runway-gen-4";
  onVideoModelVariantChange: (v: "veo-3.1-relax" | "runway-gen-4") => void;
  runwayDurationSec: 5 | 10;
  onRunwayDurationChange: (v: 5 | 10) => void;
  veoResolution: "720p" | "1080p";
  onVeoResolutionChange: (v: "720p" | "1080p") => void;
  motionCharacterUrl: string | null;
  motionCharacterUploading: boolean;
  motionCharacterUploadError: string | null;
  motionVideoUrl: string | null;
  motionVideoDurationSec: number | null;
  motionVideoUploading: boolean;
  motionVideoUploadError: string | null;
  motionVideoUploadProgress: number | null;
  motionVideoMaxLabel: string;
  onMotionCharacterSelected: (file: File) => void;
  onMotionCharacterClear: () => void;
  onMotionVideoSelected: (file: File) => void;
  onMotionVideoClear: () => void;
};

const photoAspectOptions: Array<{ value: AspectRatio; label: string }> = [
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "9:16", label: "9:16" },
];

const soraPhotoAspectOptions: Array<{ value: AspectRatio; label: string; hint: string }> = [
  { value: "3:2", label: "3:2", hint: "Photo (Standard)" },
  { value: "1:1", label: "1:1", hint: "Square" },
  { value: "2:3", label: "2:3", hint: "Portrait" },
];

const defaultAspectOptions: Array<{ value: AspectRatio; label: string }> = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

const motionAspectOptions: Array<{ value: AspectRatio; title: string; hint: string }> = [
  { value: "21:9", title: "21:9", hint: "Exclusive" },
  { value: "16:9", title: "16:9", hint: "Widescreen" },
  { value: "4:3", title: "4:3", hint: "Classic" },
  { value: "1:1", title: "1:1", hint: "Square" },
  { value: "3:4", title: "3:4", hint: "Vertical classic" },
  { value: "9:16", title: "9:16", hint: "Story (vertical)" },
];

const runwayVideoAspectOptions: Array<{ value: AspectRatio; title: string; hint: string }> = [
  { value: "21:9", title: "21:9", hint: "Exclusive" },
  { value: "16:9", title: "16:9", hint: "Widescreen" },
  { value: "4:3", title: "4:3", hint: "Classic" },
  { value: "1:1", title: "1:1", hint: "Square" },
  { value: "3:4", title: "3:4", hint: "Vertical classic" },
  { value: "9:16", title: "9:16", hint: "Story (vertical)" },
];

export function WorkspacePanel({
  selectedModel,
  prompt,
  aspectRatio,
  isLoading,
  deliveryPending,
  resultUrl,
  resultMessage,
  selectedVoice,
  voiceError,
  generationSubmitError,
  queueBlocked,
  showMediaInputModes,
  mediaInputMode,
  onMediaInputModeChange,
  referenceImageUrl,
  referenceUploading,
  referenceUploadError,
  onReferenceFileSelected,
  onClearReference,
  onPromptChange,
  onAspectRatioChange,
  onVoiceChange,
  onGenerate,
  previewDownloadGenerationId,
  transcriptionFileUrl,
  transcriptionUploading,
  transcriptionUploadError,
  transcriptionUploadProgress,
  onTranscriptionFileSelected,
  onClearTranscriptionFile,
  enhanceFileUrl,
  enhanceUploading,
  enhanceUploadError,
  enhanceUploadProgress,
  enhanceMaxLabel,
  enhanceQuality,
  enhanceFps,
  onEnhanceFileSelected,
  onEnhanceFileClear,
  onEnhanceQualityChange,
  onEnhanceFpsChange,
  photoModelVariant,
  onPhotoModelVariantChange,
  videoModelVariant,
  onVideoModelVariantChange,
  runwayDurationSec,
  onRunwayDurationChange,
  veoResolution,
  onVeoResolutionChange,
  motionCharacterUrl,
  motionCharacterUploading,
  motionCharacterUploadError,
  motionVideoUrl,
  motionVideoDurationSec,
  motionVideoUploading,
  motionVideoUploadError,
  motionVideoUploadProgress,
  motionVideoMaxLabel,
  onMotionCharacterSelected,
  onMotionCharacterClear,
  onMotionVideoSelected,
  onMotionVideoClear,
}: WorkspacePanelProps) {
  const isPhotoMode = selectedModel?.id === "photo";
  const isVideoMode = selectedModel?.id === "video";
  const isVoiceMode = selectedModel?.id === "voice";
  const isTranscriptionMode = selectedModel?.id === "transcription";
  const isVideoEnhanceMode = selectedModel?.id === "video-enhance";
  const isMotionTransferMode = selectedModel?.id === "motion-transfer";
  const voiceMaxChars = 4000;
  const textFromLabel = isPhotoMode ? "Из текста в фото" : "Из текста в видео";
  const imageFromLabel = isPhotoMode ? "Из фото в фото" : "Из фото в видео";
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const { enabled: maintenanceLocked } = useMaintenance();

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
      className={[
        "rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-all duration-500 sm:p-6",
        selectedModel ? "shadow-[0_24px_90px_rgba(220,223,224,0.08)]" : "",
      ].join(" ")}
    >
      <AnimatePresence mode="wait">
        {!selectedModel ? (
          <motion.div
            key="workspace-empty"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
            className="flex min-h-[360px] flex-col items-center justify-center rounded-[28px] border border-dashed border-white/20 bg-black/20 px-6 text-center"
          >
            <div className="mb-5 rounded-full border border-white/20 bg-white/10 p-5 text-zinc-100 shadow-[0_0_28px_rgba(220,223,224,0.14)]">
              <PanelsTopLeft className="h-7 w-7" />
            </div>
            <h3 className="text-2xl font-semibold text-white">Рабочая зона</h3>
            <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
              Пожалуйста, выберите нейросеть из списка выше, чтобы начать.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={selectedModel.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.3 }}
            className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]"
          >
            <div className="rounded-[28px] border border-white/10 bg-black/25 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <div className="mb-6">
                <p className="text-sm uppercase tracking-[0.24em] text-zinc-500">
                  Рабочая зона
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {selectedModel.name}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {selectedModel.description}
                </p>
              </div>

              <div className="space-y-5">
                {isVoiceMode ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-zinc-300">Голос</p>
                    <button
                      type="button"
                      onClick={() => setVoiceModalOpen(true)}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-[24px] border px-4 py-4 text-left transition",
                        selectedVoice
                          ? "border-amber-400/35 bg-amber-500/10 shadow-[0_0_26px_rgba(245,158,11,0.12)]"
                          : "border-white/10 bg-white/5 hover:border-amber-400/25 hover:bg-amber-500/5",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-3">
                        <span className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-2 text-amber-200">
                          <Mic className="h-5 w-5" />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-white">
                            {selectedVoice ? selectedVoice.name : "Выберите голос"}
                          </span>
                          <span className="mt-1 block text-xs text-zinc-400">
                            {selectedVoice
                              ? "Откроется каталог с фильтрами, как в макете"
                              : "Нажмите, чтобы открыть каталог"}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-zinc-500" />
                    </button>
                    {voiceError ? (
                      <p className="text-sm text-red-300">{voiceError}</p>
                    ) : null}
                  </div>
                ) : null}

                {showMediaInputModes ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-zinc-300">Режим</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onMediaInputModeChange("TEXT")}
                        className={[
                          "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
                          mediaInputMode === "TEXT"
                            ? "border-white/20 bg-white/10 text-white shadow-[0_0_20px_rgba(220,223,224,0.12)]"
                            : "border-white/10 bg-black/25 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
                        ].join(" ")}
                      >
                        <Type className="h-4 w-4 opacity-80" />
                        {textFromLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => onMediaInputModeChange("IMAGE_REF")}
                        className={[
                          "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
                          mediaInputMode === "IMAGE_REF"
                            ? "border-fuchsia-400/45 bg-fuchsia-500/15 text-white shadow-[0_0_20px_rgba(192,38,211,0.18)]"
                            : "border-white/10 bg-black/25 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
                        ].join(" ")}
                      >
                        <FileImage className="h-4 w-4 opacity-80" />
                        {imageFromLabel}
                      </button>
                    </div>
                  </div>
                ) : null}

                {isPhotoMode ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300" htmlFor="photo-model-variant">
                      Модель фото
                    </label>
                    <div className="relative">
                      <select
                        id="photo-model-variant"
                        value={photoModelVariant}
                        onChange={(e) =>
                          onPhotoModelVariantChange(e.target.value as "nana2" | "nana-pro" | "sora-image")
                        }
                        className="w-full appearance-none rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 pr-11 text-sm text-white outline-none transition focus:border-white/30"
                      >
                        <option value="nana2">Nana Banana 2</option>
                        <option value="nana-pro">Nana Banana Pro</option>
                        <option value="sora-image">Sora image</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>
                ) : null}
                {isVideoMode ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300" htmlFor="video-model-variant">
                      Модель видео
                    </label>
                    <div className="relative">
                      <select
                        id="video-model-variant"
                        value={videoModelVariant}
                        onChange={(e) =>
                          onVideoModelVariantChange(e.target.value as "veo-3.1-relax" | "runway-gen-4")
                        }
                        className="w-full appearance-none rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 pr-11 text-sm text-white outline-none transition focus:border-white/30"
                      >
                        <option value="veo-3.1-relax">Veo 3.1 Relax</option>
                        <option value="runway-gen-4">Runway Gen-4</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>
                ) : null}
                {isVideoMode && videoModelVariant === "veo-3.1-relax" ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300" htmlFor="veo-resolution">
                      Разрешение видео
                    </label>
                    <div className="relative">
                      <select
                        id="veo-resolution"
                        value={veoResolution}
                        onChange={(e) =>
                          onVeoResolutionChange(e.target.value as "720p" | "1080p")
                        }
                        className="w-full appearance-none rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 pr-11 text-sm text-white outline-none transition focus:border-white/30"
                      >
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>
                ) : null}
                {isVideoMode && videoModelVariant === "runway-gen-4" ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300" htmlFor="runway-duration">
                      Длительность видео
                    </label>
                    <div className="relative">
                      <select
                        id="runway-duration"
                        value={String(runwayDurationSec)}
                        onChange={(e) => onRunwayDurationChange(e.target.value === "10" ? 10 : 5)}
                        className="w-full appearance-none rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 pr-11 text-sm text-white outline-none transition focus:border-white/30"
                      >
                        <option value="5">5 секунд</option>
                        <option value="10">10 секунд</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>
                ) : null}

                {showMediaInputModes && mediaInputMode === "IMAGE_REF" ? (
                  <div className="space-y-3 rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/5 p-4">
                    <p className="text-sm font-medium text-fuchsia-100/95">Исходное фото</p>
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-fuchsia-400/35 bg-black/30 px-4 py-8 transition hover:border-fuchsia-400/55 hover:bg-black/40">
                      <Upload className="h-8 w-8 text-fuchsia-200/80" />
                      <span className="text-center text-sm text-zinc-300">
                        {referenceUploading ? "Загрузка…" : "Нажмите или перетащите файл (PNG, JPEG, WebP, GIF)"}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                        className="sr-only"
                        disabled={referenceUploading || queueBlocked}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) onReferenceFileSelected(file);
                        }}
                      />
                    </label>
                    {referenceUploadError ? (
                      <p className="text-sm text-red-300">{referenceUploadError}</p>
                    ) : null}
                    {referenceImageUrl ? (
                      <div className="relative overflow-hidden rounded-2xl border border-white/10">
                        <img
                          src={referenceImageUrl}
                          alt="Референс"
                          className="max-h-56 w-full object-contain bg-black/40"
                        />
                        <button
                          type="button"
                          onClick={onClearReference}
                          className="absolute right-2 top-2 rounded-xl border border-white/20 bg-black/70 p-2 text-zinc-200 transition hover:bg-black/90"
                          aria-label="Убрать фото"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isTranscriptionMode ? (
                  <div className="space-y-5">
                    <div className="space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-medium text-zinc-200">Файл видео или аудио</p>
                      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-black/30 px-4 py-8 transition hover:border-white/30 hover:bg-black/40">
                        <Upload className="h-8 w-8 text-zinc-300" />
                        <span className="text-center text-sm text-zinc-300">
                          {transcriptionFileUrl
                            ? "Файл уже загружен. Чтобы выбрать другой, сначала удалите текущий."
                            : transcriptionUploading
                            ? "Загрузка…"
                            : `Нажмите и выберите файл (до ${MAX_TRANSCRIPTION_UPLOAD_LABEL})`}
                        </span>
                        <input
                          type="file"
                          accept="video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a,.aac,.flac,.mpeg,.mpg"
                          className="sr-only"
                          disabled={transcriptionUploading || queueBlocked || Boolean(transcriptionFileUrl)}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) onTranscriptionFileSelected(file);
                          }}
                        />
                      </label>
                      {transcriptionUploading ? (
                        <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                          <div className="flex items-center justify-between text-xs text-zinc-300">
                            <span>Прогресс загрузки</span>
                            <span>
                              {typeof transcriptionUploadProgress === "number"
                                ? `${transcriptionUploadProgress}%`
                                : "…"}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={[
                                "h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all duration-300",
                                typeof transcriptionUploadProgress === "number" ? "" : "animate-pulse w-1/3",
                              ].join(" ")}
                              style={
                                typeof transcriptionUploadProgress === "number"
                                  ? { width: `${Math.max(2, transcriptionUploadProgress)}%` }
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                      {transcriptionUploadError ? (
                        <p className="text-sm text-red-300">{transcriptionUploadError}</p>
                      ) : null}
                      {transcriptionFileUrl ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
                          <span className="truncate">Файл загружен</span>
                          <button
                            type="button"
                            onClick={onClearTranscriptionFile}
                            className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-zinc-200 transition hover:bg-white/10"
                          >
                            Убрать файл
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-300" htmlFor="transcription-link">
                        Или ссылка на видео / аудио
                      </label>
                      <input
                        id="transcription-link"
                        type="url"
                        inputMode="url"
                        value={prompt}
                        onChange={(e) => onPromptChange(e.target.value)}
                        placeholder="https://…"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-white/30"
                      />
                      <p className="text-xs text-zinc-500">Достаточно файла или ссылки.</p>
                    </div>
                  </div>
                ) : isVideoEnhanceMode ? (
                  <div className="space-y-5">
                    <div className="space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-medium text-zinc-200">Файл видео</p>
                      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-black/30 px-4 py-8 transition hover:border-white/30 hover:bg-black/40">
                        <Upload className="h-8 w-8 text-zinc-300" />
                        <span className="text-center text-sm text-zinc-300">
                          {enhanceFileUrl
                            ? "Файл уже загружен. Чтобы выбрать другой, сначала удалите текущий."
                            : enhanceUploading
                              ? "Загрузка…"
                              : `Перетащите файл сюда или нажмите, чтобы загрузить`}
                        </span>
                        <span className="text-center text-xs text-zinc-500">
                          {`MP4, WEBM, MOV (max. ${enhanceMaxLabel}) (до 25 секунд) · 1 файл`}
                        </span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                          className="sr-only"
                          disabled={enhanceUploading || queueBlocked || Boolean(enhanceFileUrl)}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) onEnhanceFileSelected(file);
                          }}
                        />
                      </label>
                      {enhanceUploading ? (
                        <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                          <div className="flex items-center justify-between text-xs text-zinc-300">
                            <span>Прогресс загрузки</span>
                            <span>{typeof enhanceUploadProgress === "number" ? `${enhanceUploadProgress}%` : "…"}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={[
                                "h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all duration-300",
                                typeof enhanceUploadProgress === "number" ? "" : "animate-pulse w-1/3",
                              ].join(" ")}
                              style={
                                typeof enhanceUploadProgress === "number"
                                  ? { width: `${Math.max(2, enhanceUploadProgress)}%` }
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                      {enhanceUploadError ? <p className="text-sm text-red-300">{enhanceUploadError}</p> : null}
                      {enhanceFileUrl ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
                          <span className="truncate">Видео загружено</span>
                          <button
                            type="button"
                            onClick={onEnhanceFileClear}
                            className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-zinc-200 transition hover:bg-white/10"
                          >
                            Убрать файл
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-2">
                        <span className="block text-sm font-medium text-zinc-300">Качество</span>
                        <select
                          value={enhanceQuality}
                          onChange={(e) => onEnhanceQualityChange(e.target.value as "original" | "2x" | "4x")}
                          className="w-full rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 text-sm text-white outline-none transition focus:border-white/30"
                        >
                          <option value="original">Оригинальное</option>
                          <option value="2x">2x</option>
                          <option value="4x">4x</option>
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="block text-sm font-medium text-zinc-300">Частота кадров (FPS)</span>
                        <select
                          value={enhanceFps}
                          onChange={(e) =>
                            onEnhanceFpsChange(e.target.value as "24" | "25" | "30" | "45" | "50" | "60")
                          }
                          className="w-full rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 text-sm text-white outline-none transition focus:border-white/30"
                        >
                          <option value="24">24</option>
                          <option value="25">25</option>
                          <option value="30">30</option>
                          <option value="45">45</option>
                          <option value="50">50</option>
                          <option value="60">60</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ) : isMotionTransferMode ? (
                  <div className="space-y-5">
                    <div className="space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-medium text-zinc-200">Загрузить персонажа</p>
                      <p className="text-xs leading-5 text-zinc-400">
                        Генерация анимирует окружение и переносит движения и жесты с видео на персонажа.
                        Для лучшего качества используйте одного человека в кадре и снимайте его по пояс.
                      </p>
                      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-black/30 px-4 py-8 transition hover:border-white/30 hover:bg-black/40">
                        <Upload className="h-8 w-8 text-zinc-300" />
                        <span className="text-center text-sm text-zinc-300">
                          {motionCharacterUrl
                            ? "Персонаж загружен. Чтобы выбрать другой, сначала удалите текущий."
                            : motionCharacterUploading
                              ? "Загрузка…"
                              : "Загрузить персонажа"}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                          className="sr-only"
                          disabled={motionCharacterUploading || queueBlocked || Boolean(motionCharacterUrl)}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) onMotionCharacterSelected(file);
                          }}
                        />
                      </label>
                      {motionCharacterUploadError ? (
                        <p className="text-sm text-red-300">{motionCharacterUploadError}</p>
                      ) : null}
                      {motionCharacterUrl ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
                          <span className="truncate">Персонаж загружен</span>
                          <button
                            type="button"
                            onClick={onMotionCharacterClear}
                            className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-zinc-200 transition hover:bg-white/10"
                          >
                            Убрать файл
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-medium text-zinc-200">Загрузить видео</p>
                      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-black/30 px-4 py-8 transition hover:border-white/30 hover:bg-black/40">
                        <Upload className="h-8 w-8 text-zinc-300" />
                        <span className="text-center text-sm text-zinc-300">
                          {motionVideoUrl
                            ? "Видео загружено. Чтобы выбрать другое, сначала удалите текущее."
                            : motionVideoUploading
                              ? "Загрузка…"
                              : "Перетащите файл сюда или нажмите, чтобы загрузить"}
                        </span>
                        <span className="text-center text-xs text-zinc-500">
                          {`MP4, WEBM, MOV (max. ${motionVideoMaxLabel}) (3-30 секунд) · 1 файл`}
                        </span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                          className="sr-only"
                          disabled={motionVideoUploading || queueBlocked || Boolean(motionVideoUrl)}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) onMotionVideoSelected(file);
                          }}
                        />
                      </label>
                      {motionVideoUploading ? (
                        <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                          <div className="flex items-center justify-between text-xs text-zinc-300">
                            <span>Прогресс загрузки</span>
                            <span>{typeof motionVideoUploadProgress === "number" ? `${motionVideoUploadProgress}%` : "…"}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={[
                                "h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all duration-300",
                                typeof motionVideoUploadProgress === "number" ? "" : "animate-pulse w-1/3",
                              ].join(" ")}
                              style={
                                typeof motionVideoUploadProgress === "number"
                                  ? { width: `${Math.max(2, motionVideoUploadProgress)}%` }
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                      {motionVideoUploadError ? <p className="text-sm text-red-300">{motionVideoUploadError}</p> : null}
                      {motionVideoUrl ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
                          <span className="truncate">
                            Видео загружено{typeof motionVideoDurationSec === "number" ? ` · ${motionVideoDurationSec} сек` : ""}
                          </span>
                          <button
                            type="button"
                            onClick={onMotionVideoClear}
                            className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-zinc-200 transition hover:bg-white/10"
                          >
                            Убрать файл
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-300" htmlFor="motion-aspect">
                        Соотношение сторон
                      </label>
                      <select
                        id="motion-aspect"
                        value={aspectRatio}
                        onChange={(e) => onAspectRatioChange(e.target.value as AspectRatio)}
                        className="w-full rounded-2xl border border-white/10 bg-[#221f22] px-4 py-3 text-sm text-white outline-none transition focus:border-white/30"
                      >
                        {motionAspectOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {`${o.title} — ${o.hint}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-zinc-300" htmlFor="prompt">
                      {showMediaInputModes && mediaInputMode === "IMAGE_REF"
                        ? "Пожелания к изменению (необязательно)"
                        : "Ваш промпт:"}
                    </label>
                    <textarea
                      id="prompt"
                      value={prompt}
                      onChange={(event) => onPromptChange(event.target.value)}
                      maxLength={
                        isVoiceMode
                          ? voiceMaxChars
                          : isVideoMode && videoModelVariant === "runway-gen-4"
                            ? 1000
                            : undefined
                      }
                      placeholder={
                        showMediaInputModes && mediaInputMode === "IMAGE_REF"
                          ? "Например: сделать вечерний свет, добавить дождь, сменить стиль на аниме…"
                          : "Опишите желаемый результат"
                      }
                      className="min-h-[220px] w-full resize-none rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-white outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-zinc-500 focus:border-white/30 focus:bg-white/8 focus:shadow-[0_0_0_1px_rgba(220,223,224,0.2),0_0_24px_rgba(220,223,224,0.1)]"
                    />
                    {isVoiceMode ? (
                      <p className="text-xs text-zinc-500">{`Символов: ${prompt.length}/${voiceMaxChars}`}</p>
                    ) : null}
                    {isVideoMode && videoModelVariant === "runway-gen-4" ? (
                      <p className="text-xs text-zinc-500">{`Символов: ${prompt.length}/1000`}</p>
                    ) : null}
                  </div>
                )}

                {!isVoiceMode && !isTranscriptionMode && !isVideoEnhanceMode && !isMotionTransferMode ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                      <Wand2 className="h-4 w-4 text-zinc-300" />
                      Соотношение сторон
                    </div>

                    {isPhotoMode || isVideoMode ? (
                      isPhotoMode ? (
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
                        {(photoModelVariant === "sora-image"
                          ? soraPhotoAspectOptions.map((o) => ({ value: o.value, label: `${o.label}` }))
                          : photoAspectOptions
                        ).map((option) => {
                          const checked = aspectRatio === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onAspectRatioChange(option.value)}
                              className={[
                                "rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-300",
                                checked
                                  ? "border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(220,223,224,0.12)]"
                                  : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10",
                              ].join(" ")}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      ) : (
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
                        {(videoModelVariant === "runway-gen-4"
                          ? runwayVideoAspectOptions.map((o) => ({ value: o.value, label: o.title }))
                          : defaultAspectOptions
                        ).map((option) => {
                          const checked = aspectRatio === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onAspectRatioChange(option.value)}
                              className={[
                                "rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-300",
                                checked
                                  ? "border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(220,223,224,0.12)]"
                                  : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10",
                              ].join(" ")}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      )
                    ) : null}
                  </div>
                ) : null}

                {queueBlocked ? (
                  <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/95">
                    У вас уже есть заявка в работе. Дождитесь результата — затем можно отправить новую
                    заявку, выбрав любую модель.
                  </p>
                ) : null}
                {generationSubmitError ? (
                  <p className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {generationSubmitError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={
                    maintenanceLocked ||
                    isLoading ||
                    queueBlocked ||
                    referenceUploading ||
                    transcriptionUploading ||
                    enhanceUploading ||
                    (showMediaInputModes &&
                      mediaInputMode === "IMAGE_REF" &&
                      !referenceImageUrl) ||
                    (isTranscriptionMode &&
                      !transcriptionFileUrl?.trim() &&
                      !prompt.trim()) ||
                    (isVideoEnhanceMode && !enhanceFileUrl?.trim()) ||
                    (isMotionTransferMode && (!motionCharacterUrl?.trim() || !motionVideoUrl?.trim()))
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-[#27272a] px-5 py-4 text-sm font-semibold text-white shadow-[0_0_24px_rgba(220,223,224,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#303030] hover:shadow-[0_0_30px_rgba(220,223,224,0.18)] focus:outline-none focus:ring-2 focus:ring-white/30 disabled:pointer-events-none disabled:opacity-45"
                >
                  <Sparkles className="h-4 w-4" />
                  Сгенерировать
                </button>
              </div>
            </div>

            <ResultPreview
              aspectRatio={aspectRatio}
              isLoading={isLoading}
              deliveryPending={deliveryPending}
              resultUrl={resultUrl}
              resultMessage={resultMessage}
              downloadGenerationId={previewDownloadGenerationId}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <VoicePickerModal
        open={voiceModalOpen}
        value={selectedVoice}
        onClose={() => setVoiceModalOpen(false)}
        onConfirm={(voice) => {
          onVoiceChange(voice);
        }}
      />
    </motion.section>
  );
}

