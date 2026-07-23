-- Kullanıcı bildirim tercihleri (sunucu + cron saygı duyar)
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs is
  'portal, appointment, commission, digest, marketing boolean flags';
