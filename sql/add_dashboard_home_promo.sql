-- HTML-плашка на главной кабинета (между приветствием и выбором модели).
-- ОБЯЗАТЕЛЬНО: Supabase Dashboard -> SQL Editor -> New query -> вставьте весь файл -> Run.
-- Без этой таблицы ошибка PGRST205 / "Could not find table DashboardHomePromo".
create table if not exists "DashboardHomePromo" (
  "id" text primary key,
  "enabled" boolean not null default false,
  "html" text not null default '',
  "updatedAt" timestamptz default now()
);

insert into "DashboardHomePromo" ("id", "enabled", "html")
values ('global', false, '')
on conflict ("id") do nothing;
