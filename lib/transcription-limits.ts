/** Лимит размера файла для транскрибации (совпадает с API). */
export const MAX_TRANSCRIPTION_UPLOAD_BYTES = 3 * 1024 * 1024 * 1024;

/** Подпись в интерфейсе (при смене лимита обновите и число в API-сообщениях при необходимости). */
export const MAX_TRANSCRIPTION_UPLOAD_LABEL = "3 ГБ";

/** Topaz: ограничения загрузки исходника видео для улучшения. */
export const MAX_TOPAZ_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_TOPAZ_UPLOAD_LABEL = "50 МБ";

export const MAX_ACT_TWO_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ACT_TWO_VIDEO_UPLOAD_LABEL = "20 МБ";
