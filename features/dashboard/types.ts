import type { LucideIcon } from "lucide-react";

export type AspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

/** Режим входа для фото/видео: только текст или референс-изображение */
export type MediaInputMode = "TEXT" | "IMAGE_REF";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type Model = {
  id: string;
  name: string;
  description: string;
  accent: string;
  icon: LucideIcon;
  category: string;
  disabled?: boolean;
  disabledLabel?: string;
};

export type LogStatus = "success" | "queued" | "error";

export type LogItem = {
  id: string;
  action: string;
  model: string;
  status: LogStatus;
  createdAt: string;
  prompt: string;
  duration: string;
};
