-- Плашка-объявление в верхней части пользовательского кабинета.
-- Выполните в Supabase SQL Editor.
create table if not exists "DashboardBanner" (
  "id" text primary key,
  "enabled" boolean not null default false,
  "message" text not null default '',
  "updatedAt" timestamptz default now()
);

insert into "DashboardBanner" ("id", "enabled", "message")
values ('global', false, '')
on conflict ("id") do nothing;
