"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
};

const photoAspectOptions: Array<{ value: AspectRatio; label: string; aspectClass: string }> = [
  { value: "16:9", label: "16:9", aspectClass: "aspect-[16/9]" },
  { value: "4:3", label: "4:3", aspectClass: "aspect-[4/3]" },
  { value: "1:1", label: "1:1", aspectClass: "aspect-square" },
  { value: "3:4", label: "3:4", aspectClass: "aspect-[3/4]" },
  { value: "9:16", label: "9:16", aspectClass: "aspect-[9/16]" },
];

const defaultAspectOptions: Array<{ value: AspectRatio; label: string; aspectClass: string }> = [
  { value: "16:9", label: "16:9", aspectClass: "aspect-[16/9]" },
  { value: "9:16", label: "9:16", aspectClass: "aspect-[9/16]" },
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
}: WorkspacePanelProps) {
  const isPhotoMode = selectedModel?.id === "photo";
  const isVideoMode = selectedModel?.id === "video";
  const isVoiceMode = selectedModel?.id === "voice";
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

                <div className="space-y-3">
                  <label className="text-sm font-medium text-zinc-300" htmlFor="prompt">
                    {showMediaInputModes && mediaInputMode === "IMAGE_REF"
                      ? "Пожелания к изменению (необязательно)"
                      : "Prompt"}
                  </label>
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    placeholder={
                      showMediaInputModes && mediaInputMode === "IMAGE_REF"
                        ? "Например: сделать вечерний свет, добавить дождь, сменить стиль на аниме…"
                        : "Опишите желаемый результат: стиль, композицию, освещение, атмосферу..."
                    }
                    className="min-h-[220px] w-full resize-none rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-white outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-zinc-500 focus:border-white/30 focus:bg-white/8 focus:shadow-[0_0_0_1px_rgba(220,223,224,0.2),0_0_24px_rgba(220,223,224,0.1)]"
                  />
                </div>

                {!isVoiceMode ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                      <Wand2 className="h-4 w-4 text-zinc-300" />
                      Aspect Ratio
                    </div>

                    {isPhotoMode || isVideoMode ? (
                      isPhotoMode ? (
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
                        {photoAspectOptions.map((option) => {
                          const checked = aspectRatio === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onAspectRatioChange(option.value)}
                              className={[
                                "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-300",
                                checked
                                  ? "border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(220,223,224,0.12)]"
                                  : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "h-4 w-6 rounded-[4px] border",
                                  option.aspectClass,
                                  checked ? "border-white/35 bg-white/10" : "border-white/20 bg-black/20",
                                ].join(" ")}
                              />
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      ) : (
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
                        {defaultAspectOptions.map((option) => {
                          const checked = aspectRatio === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onAspectRatioChange(option.value)}
                              className={[
                                "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-300",
                                checked
                                  ? "border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(220,223,224,0.12)]"
                                  : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "h-4 w-6 rounded-[4px] border",
                                  option.aspectClass,
                                  checked ? "border-white/35 bg-white/10" : "border-white/20 bg-black/20",
                                ].join(" ")}
                              />
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
                    (showMediaInputModes &&
                      mediaInputMode === "IMAGE_REF" &&
                      !referenceImageUrl)
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

