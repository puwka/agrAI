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
    description: "Личные данные и контакты.",
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
    accent: "from-white/8 via-zinc-500/10 to-zinc-950/55",
    icon: Image,
    category: "Фото",
  },
  {
    id: "video",
    name: "Генерация видео",
    description:
      "Два режима: из текста в видео или из вашего фото в видео (анимация, сценарий по кадру).",
    accent: "from-white/6 via-zinc-600/8 to-zinc-950/50",
    icon: Video,
    category: "Видео",
  },
  {
    id: "voice",
    name: "Генерация голоса",
    description: "Озвучка и голосовые варианты: тон, тембр, скорость, эмоции.",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: Mic,
    category: "Голос",
  },
  {
    id: "model-labs",
    name: "Лаборатория",
    description: "Экспериментальный режим. Сейчас недоступен для пользователей.",
    accent: "from-zinc-600/10 to-zinc-950/60",
    icon: WandSparkles,
    category: "В разработке",
    disabled: true,
    disabledLabel: "В разработке",
  },
];
