import type { AspectRatio } from "./types";

export type PhotoModelVariant =
  | "nana2"
  | "nana-pro"
  | "sora-image"
  | "gpt-image-2"
  | "flux-2-pro"
  | "recraft-v3"
  | "ideogram-v3"
  | "qwen-image-2"
  | "seedream-v5-lite";

export const PHOTO_MODEL_VARIANTS: PhotoModelVariant[] = [
  "nana2",
  "nana-pro",
  "sora-image",
  "gpt-image-2",
  "flux-2-pro",
  "recraft-v3",
  "ideogram-v3",
  "qwen-image-2",
  "seedream-v5-lite",
];

/** Модели фото, которые обрабатывает Syntx-воркер. */
export const SYNTX_PHOTO_VARIANTS: PhotoModelVariant[] = [
  "sora-image",
  "gpt-image-2",
  "flux-2-pro",
  "recraft-v3",
  "ideogram-v3",
  "qwen-image-2",
  "seedream-v5-lite",
];

export const PHOTO_MODEL_LABELS: Record<PhotoModelVariant, string> = {
  nana2: "Nana Banana 2",
  "nana-pro": "Nana Banana Pro",
  "sora-image": "Sora image",
  "gpt-image-2": "GPT Image 2",
  "flux-2-pro": "Flux 2 Pro",
  "recraft-v3": "Recraft V3",
  "ideogram-v3": "Ideogram V3",
  "qwen-image-2": "Qwen Image 2",
  "seedream-v5-lite": "Seedream v5 lite",
};

const EXTENDED_ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "8:1", label: "8:1" },
  { value: "4:1", label: "4:1" },
  { value: "21:9", label: "21:9" },
  { value: "2:1", label: "2:1" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "9:16", label: "9:16" },
  { value: "1:2", label: "1:2" },
  { value: "9:21", label: "9:21" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
  { value: "1:4", label: "1:4" },
  { value: "1:8", label: "1:8" },
];

const GPT_SEEDREAM_ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "21:9", label: "21:9" },
  { value: "2:1", label: "2:1" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "9:16", label: "9:16" },
  { value: "1:2", label: "1:2" },
  { value: "9:21", label: "9:21" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
];

const FLUX_2_PRO_ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "2:1", label: "2:1" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "9:16", label: "9:16" },
  { value: "1:2", label: "1:2" },
];

const NANA_ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "9:16", label: "9:16" },
];

const SORA_ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "3:2", label: "3:2" },
  { value: "1:1", label: "1:1" },
  { value: "2:3", label: "2:3" },
];

const PHOTO_ASPECT_BY_VARIANT: Record<PhotoModelVariant, Array<{ value: AspectRatio; label: string }>> = {
  nana2: NANA_ASPECT_OPTIONS,
  "nana-pro": NANA_ASPECT_OPTIONS,
  "sora-image": SORA_ASPECT_OPTIONS,
  "gpt-image-2": GPT_SEEDREAM_ASPECT_OPTIONS,
  "flux-2-pro": FLUX_2_PRO_ASPECT_OPTIONS,
  "recraft-v3": EXTENDED_ASPECT_OPTIONS,
  "ideogram-v3": EXTENDED_ASPECT_OPTIONS,
  "qwen-image-2": EXTENDED_ASPECT_OPTIONS,
  "seedream-v5-lite": GPT_SEEDREAM_ASPECT_OPTIONS.filter(
    (o) => o.value !== "5:4" && o.value !== "4:5",
  ),
};

const VARIANT_ID_SET = new Set<string>(PHOTO_MODEL_VARIANTS);

export function isSyntxPhotoVariant(variant: PhotoModelVariant): boolean {
  return SYNTX_PHOTO_VARIANTS.includes(variant);
}

export function getPhotoAspectOptions(
  variant: PhotoModelVariant,
): Array<{ value: AspectRatio; label: string }> {
  return PHOTO_ASPECT_BY_VARIANT[variant];
}

export function isPhotoAspectValid(variant: PhotoModelVariant, aspect: AspectRatio): boolean {
  return getPhotoAspectOptions(variant).some((o) => o.value === aspect);
}

export function parsePhotoModelVariant(raw: string, modelName?: string): PhotoModelVariant {
  const v = raw.trim().toLowerCase();
  if (VARIANT_ID_SET.has(v)) return v as PhotoModelVariant;

  const name = (modelName ?? "").toLowerCase();
  if (name.includes("flux 2 pro") || name.includes("flux-2-pro")) return "flux-2-pro";
  if (name.includes("recraft v3") || name.includes("recraft-v3")) return "recraft-v3";
  if (name.includes("ideogram v3") || name.includes("ideogram-v3")) return "ideogram-v3";
  if (name.includes("qwen image 2") || name.includes("qwen-image-2")) return "qwen-image-2";
  if (name.includes("seedream") || name.includes("seedrea")) return "seedream-v5-lite";
  if (name.includes("gpt image 2") || name.includes("gpt-image-2")) return "gpt-image-2";
  if (name.includes("sora image")) return "sora-image";
  if (name.includes("nana banana pro")) return "nana-pro";
  return "nana2";
}

export function photoModelDisplayLabel(variant: PhotoModelVariant): string {
  return PHOTO_MODEL_LABELS[variant];
}
