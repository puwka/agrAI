-- Голоса, добавленные вручную в админке (подмешиваются в каталог для пользователей).
-- Выполните в Supabase SQL Editor.

create table if not exists "CustomVoice" (
  "voiceId" text primary key,
  "name" text not null,
  "gender" text not null default '',
  "locale" text not null default '',
  "previewUrl" text not null default '',
  "tagsJson" text not null default '[]',
  "createdAt" timestamptz default now(),
  "updatedAt" timestamptz default now()
);
