-- MIGRATION 20261019010001_property_nearby_places.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261019010001_property_nearby_places.rollback.sql (sutun duser; danismanin girdigi
--   cevre noktalari kaybolur, vitrin "Cevrede neler var" bolumu gizlenir).
-- BAGIMLILIK: yok.
--
-- NE (PUB-8): ilan detayinda "Cevrede neler var" (okul, metro/otobus, hastane, market ...). Dis harita anahtari
--   olmadan ve ucuncu taraf servise (Overpass) bagimli olmadan GUVENILIR yol: danisman portfoy sayfasinda yakin
--   noktalari girer (kategori, ad, mesafe m). properties.nearby_places jsonb dizisi; ogeler
--   {"c": kategori, "n": ad, "m": metre}. Bicim uygulamada dogrulanir (src/lib/vitrin/nearby.ts, saf + testli);
--   DB yalniz dizi + en cok 24 oge kuralini tutar. Yazma mevcut properties RLS/guncelleme yolundan gecer.
set local lock_timeout = '5s';

alter table public.properties
  add column if not exists nearby_places jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_nearby_places_shape' and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_nearby_places_shape
      check (jsonb_typeof(nearby_places) = 'array' and jsonb_array_length(nearby_places) <= 24);
  end if;
end;
$$;

comment on column public.properties.nearby_places is
  'PUB-8: danismanin girdigi yakin cevre noktalari [{c: kategori, n: ad, m: metre}] (vitrin ilan detayi "Cevrede neler var").';
