-- Блокировка отдельных нейросетей с текстом-оверлеем на карточке.
-- Выполните в Supabase SQL Editor.
create table if not exists "ModelLock" (
  "modelId" text primary key,
  "enabled" boolean not null default true,
  "message" text not null default '',
  "updatedAt" timestamptz default now()
);
