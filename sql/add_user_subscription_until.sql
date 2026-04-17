-- Выполните в Supabase SQL Editor (один раз).
-- Дата окончания подписки для обычных пользователей; для ADMIN не проверяется.

alter table "User"
  add column if not exists "subscriptionUntil" timestamptz null;

comment on column "User"."subscriptionUntil" is 'До этой даты (не включительно по истечении суток UTC — сравнение в приложении по timestamp) пользователь USER может создавать генерации. NULL = нет активной подписки.';
