import {
  Activity,
  Captions,
  Headset,
  Image,
  LayoutDashboard,
  Mic,
  Video,
  UserRound,
} from "lucide-react";

import type { Model, NavItem } from "./types";

export const navItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "Панель",
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
  {
    href: "/dashboard/support",
    label: "Поддержка",
    description: "Контакты и быстрая связь с поддержкой.",
    icon: Headset,
  },
];

export const models: Model[] = [
  {
    id: "photo",
    name: "Генерация фото",
    description:
      "Два режима: из текста в фото или из вашего фото в фото (модель - Nana Banana Pro).",
    accent: "from-white/8 via-zinc-500/10 to-zinc-950/55",
    icon: Image,
    category: "Фото",
  },
  {
    id: "video",
    name: "Генерация видео",
    description:
      "Два режима: из текста в видео или из вашего фото в видео (модель - Veo 3.1 Relax).",
    accent: "from-white/6 via-zinc-600/8 to-zinc-950/50",
    icon: Video,
    category: "Видео",
  },
  {
    id: "voice",
    name: "Генерация голоса",
    description: "Озвучка PREMIUM голосами",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: Mic,
    category: "Голос",
  },
  {
    id: "transcription",
    name: "Транскрибация",
    description:
      "Видео или аудио в текст: загрузите файл или вставьте ссылку на материал. Текст расшифровки прикрепит администратор.",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: Captions,
    category: "Текст",
  },
];
