-- Кастомные превью MP3 для голосов (админка → загрузка). Выполните в Supabase SQL Editor.

create table if not exists "VoicePreviewOverride" (
  "voiceId" text primary key,
  "previewUrl" text not null,
  "updatedAt" timestamptz default now()
);
