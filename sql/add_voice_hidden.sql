-- РЎРєСЂС‹С‚РёРµ РіРѕР»РѕСЃРѕРІ РІ РєР°С‚Р°Р»РѕРіРµ РґР»СЏ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
-- Р’С‹РїРѕР»РЅРёС‚Рµ РІ Supabase SQL Editor.

create table if not exists "VoiceHidden" (
  "voiceId" text primary key,
  "hidden" boolean not null default true,
  "updatedAt" timestamptz default now()
);
