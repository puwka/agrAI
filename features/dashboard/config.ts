import {
  Activity,
  Bot,
  Image,
  LayoutDashboard,
  Mic,
  Video,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";

import type { Model, NavItem } from "./types";

export const navItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Рабочая зона, модели и текущие генерации.",
    icon: LayoutDashboard,
  },
  {
    href: "/dashboard/profile",
    label: "Профиль",
    description: "Личные данные, предпочтения и безопасность.",
    icon: UserRound,
  },
  {
    href: "/dashboard/logs",
    label: "Логи",
    description: "История запусков, статусы и диагностика.",
    icon: Activity,
  },
];

export const models: Model[] = [
  {
    id: "photo",
    name: "Генерация фото",
    description:
      "Два режима: из текста в фото или из вашего фото в фото (редактирование, стиль, композиция).",
    accent: "from-violet-500/30 to-fuchsia-500/20",
    icon: Image,
    category: "Фото",
  },
  {
    id: "video",
    name: "Генерация видео",
    description:
      "Два режима: из текста в видео или из вашего фото в видео (анимация, сценарий по кадру).",
    accent: "from-indigo-500/30 to-violet-500/20",
    icon: Video,
    category: "Видео",
  },
  {
    id: "voice",
    name: "Генерация голоса",
    description: "Озвучка и голосовые варианты: тон, тембр, скорость, эмоции.",
    accent: "from-purple-500/30 to-pink-500/20",
    icon: Mic,
    category: "Голос",
  },
  {
    id: "model-labs",
    name: "Лаборатория",
    description: "Экспериментальный режим. Сейчас недоступен для пользователей.",
    accent: "from-fuchsia-500/30 to-violet-500/20",
    icon: WandSparkles,
    category: "В разработке",
    disabled: true,
    disabledLabel: "В разработке",
  },
];
