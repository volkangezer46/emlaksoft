-- P-HAVUZ: havuz uygunluk bayrakları (20260816001500 listing_pool_entries'e ek; mevcut migration değiştirilmedi).
--
-- Tasarım spesifikasyonu 3.2 elemesi accepts_pool / pool_paused_until / max_active_listings alanlarını ister; bunlar hiçbir
-- migration'da YOKTU. profiles'a nullable/varsayılanlı üç sütun eklenir. Kod sütunlar yokken (42703) bayraksız çalışır:
-- hepsi "havuza açık, duraklatma yok, kapasite yok (ofis ortalaması)" sayılır.
-- Yazma: mevcut profiles politikaları geçerlidir (yeni politika yok); düzenleme formu P-UZMAN alanındadır.
-- GERİ ALMA: rollbacks/20260819020200_listing_pool_profile_flags.rollback.sql. RİSK: düşük.

alter table public.profiles
  add column if not exists accepts_pool boolean not null default true,
  add column if not exists pool_paused_until timestamptz,
  add column if not exists max_active_listings integer check (max_active_listings is null or max_active_listings between 0 and 10000);

comment on column public.profiles.accepts_pool is 'false ise ilan havuzu atamalarından elenir.';
comment on column public.profiles.pool_paused_until is 'Bu zamana dek havuz atamasından elenir (geçici duraklatma).';
comment on column public.profiles.max_active_listings is 'Havuz kapasitesi (aktif ilan üst sınırı); null = ofis ortalamasına göre.';
