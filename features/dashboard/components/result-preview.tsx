"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ImagePlus, LoaderCircle } from "lucide-react";
import { motion } from "framer-motion";

import { detectResultMediaKind } from "../lib";
import type { AspectRatio } from "../types";

type ResultPreviewProps = {
  isLoading: boolean;
  /** Ожидание выгрузки результата администратором (после успешной отправки заявки) */
  deliveryPending: boolean;
  resultUrl: string;
  /** Текст от администратора, если файла нет или как пояснение */
  resultMessage: string;
  aspectRatio: AspectRatio;
  /** Если задан и есть результат — показываем ссылку на скачивание */
  downloadGenerationId: string | null;
};

const previewAspectClass: Record<AspectRatio, string> = {
  "16:9": "aspect-video",
  "4:3": "aspect-[4/3]",
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
  "9:16": "aspect-[9/16]",
};

export function ResultPreview({
  isLoading,
  deliveryPending,
  resultUrl,
  resultMessage,
  aspectRatio,
  downloadGenerationId,
}: ResultPreviewProps) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const mediaKind = useMemo(() => detectResultMediaKind(resultUrl), [resultUrl]);

  const showDownload =
    Boolean(downloadGenerationId) &&
    !isLoading &&
    !deliveryPending &&
    (Boolean(resultUrl.trim()) || Boolean(resultMessage.trim()));

  useEffect(() => {
    setMediaFailed(false);
  }, [resultUrl]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-[28px] border border-white/10 bg-black/25 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-zinc-500">Демонстрация</p>
          <h3 className="mt-2 text-xl font-semibold text-white">Результат генерации</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDownload && downloadGenerationId ? (
            <a
              href={`/api/generations/${downloadGenerationId}/download`}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/35 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:border-violet-400/50 hover:bg-violet-500/25"
            >
              <Download className="h-3.5 w-3.5" />
              {resultUrl.trim() ? "Скачать" : "Скачать .txt"}
            </a>
          ) : null}
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-400">
            {aspectRatio}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80">
        <div
          className={[
            "w-full max-h-[540px]",
            previewAspectClass[aspectRatio],
          ].join(" ")}
        >
          {resultUrl ? (
            <div className="flex h-full min-h-0 flex-col">
              {mediaFailed ? (
                <div className="flex h-full w-full min-h-0 flex-1 items-center justify-center bg-black/40 px-6 text-center text-sm text-zinc-300">
                  Файл результата недоступен для предпросмотра. Скачайте его кнопкой выше или из списка генераций.
                </div>
              ) : mediaKind === "video" ? (
                <video
                  src={resultUrl}
                  controls
                  playsInline
                  className="h-full w-full min-h-0 flex-1 object-contain bg-black"
                  onError={() => setMediaFailed(true)}
                />
              ) : mediaKind === "audio" ? (
                <div className="flex h-full w-full min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-black/50 px-6 py-8">
                  <audio src={resultUrl} controls className="w-full max-w-md" onError={() => setMediaFailed(true)} />
                </div>
              ) : (
                <img
                  src={resultUrl}
                  alt="Generated preview"
                  className="h-full w-full min-h-0 flex-1 object-cover"
                  onError={() => setMediaFailed(true)}
                />
              )}
              {resultMessage ? (
                <div className="shrink-0 border-t border-white/10 bg-black/50 px-4 py-3 text-left text-sm leading-relaxed text-zinc-200">
                  {resultMessage}
                </div>
              ) : null}
            </div>
          ) : resultMessage ? (
            <div className="flex h-full flex-col justify-center gap-3 overflow-y-auto rounded-[28px] border border-violet-400/20 bg-gradient-to-b from-violet-500/10 to-black/50 px-6 py-8">
              <p className="text-center text-xs font-medium uppercase tracking-wide text-violet-200/90">
                Ответ системы
              </p>
              <p className="text-center text-sm leading-relaxed text-zinc-100">{resultMessage}</p>
            </div>
          ) : deliveryPending ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto rounded-[28px] border border-amber-400/15 bg-gradient-to-b from-amber-500/10 to-black/40 px-4 py-6 sm:px-6">
              <LoaderCircle className="h-10 w-10 animate-spin text-amber-300 sm:h-14 sm:w-14" />
              <div className="max-w-md space-y-2 text-center">
                <p className="text-base font-semibold text-white">Генерация запущена</p>
                <p className="text-sm leading-6 text-zinc-300 sm:leading-7">
                  Результат обычно доступен в течение{" "}
                  <span className="font-semibold text-amber-200">5–15 минут</span>.
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 rounded-[28px] border border-white/10 bg-black/30">
              <LoaderCircle className="h-14 w-14 animate-spin text-violet-400" />
              <div className="space-y-2 text-center">
                <p className="text-base font-medium text-white">Отправка заявки...</p>
                <p className="text-sm text-zinc-400">Сохраняем параметры генерации</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-black/25 px-6 text-center">
              <div className="mb-5 rounded-full border border-white/10 bg-white/5 p-4 text-violet-200">
                <ImagePlus className="h-9 w-9" />
              </div>
              <p className="max-w-sm text-base font-medium text-white">
                Здесь появится результат вашей генерации
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-400">
                Выберите модель, введите промпт и запустите генерацию.
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
