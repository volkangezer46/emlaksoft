-- Takvim aboneliği (ICS feed) — /api/takvim/[token] public ucu.
-- calendar_token : kullanıcıya özel gizli anahtar; token'ı bilen takvim uygulaması
--                  (Google/Apple/Outlook) kullanıcının randevularını ICS olarak çeker.
--                  Servis role okur, RLS değişmez (randevu-teyit confirm_token deseni).
--                  "Linki yenile" yeni uuid üretir → eski abonelik linki ölür.
alter table public.profiles
  add column if not exists calendar_token uuid not null default gen_random_uuid();

-- Feed'in tek sorgusu token üzerinden — unique index hem çakışmayı engeller
-- hem aramayı indeksler (idx_appointments_confirm_token deseni).
create unique index if not exists idx_profiles_calendar_token
  on public.profiles(calendar_token);
