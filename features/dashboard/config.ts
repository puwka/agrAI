import {
  Activity,
  Captions,
  Clapperboard,
  Headset,
  Image,
  LayoutDashboard,
  Mic,
  PersonStanding,
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
      "Два режима: из текста в фото или из вашего фото в фото (модели - Nana Banana 2, Nana Banana Pro, Sora image).",
    accent: "from-white/8 via-zinc-500/10 to-zinc-950/55",
    icon: Image,
    category: "Фото",
  },
  {
    id: "video",
    name: "Генерация видео",
    description:
      "Два режима: из текста в видео или из вашего фото в видео (модели - Veo 3.1 Relax, Runway Gen-4).",
    accent: "from-white/6 via-zinc-600/8 to-zinc-950/50",
    icon: Video,
    category: "Видео",
  },
  {
    id: "voice",
    name: "Генерация голоса",
    description: "AI озвучка PREMIUM голосами.",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: Mic,
    category: "Голос",
  },
  {
    id: "transcription",
    name: "Транскрибация",
    description:
      "Видео или аудио в текст: загрузите файл или вставьте ссылку на материал (модель - Whisper).",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: Captions,
    category: "Текст",
  },
  {
    id: "video-enhance",
    name: "Улучшение качества",
    description: "Улучшение видео (модель - Topaz).",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: Clapperboard,
    category: "Видео",
  },
  {
    id: "motion-transfer",
    name: "Перенос движений",
    description:
      "Внедрите вашего персонажа в любое видео (модель - Runway Act-Two).",
    accent: "from-zinc-500/12 via-zinc-600/8 to-zinc-950/55",
    icon: PersonStanding,
    category: "Видео",
  },
];
