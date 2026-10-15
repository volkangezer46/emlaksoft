-- MIGRATION 20261019030000_property_media_room_tag_caption.sql (B3: PF-01 + PUB-9 kat plani, oda etiketi, aciklama)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261019030000_property_media_room_tag_caption.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261019030000_property_media_room_tag_caption.rollback.sql (iki sutun + iki CHECK duser).
--
-- NEDEN: kat plani siradan fotograf olarak yukleniyordu (vitrin/sunum/brosurde ayri gosterilemiyordu) ve gorsellere oda
--   etiketi / aciklama verilemiyordu (alt metin sabit "Portfoy gorseli"; erisilebilirlik + SEO zayif).
-- NE: property_media.room_tag text (bos ya da sabit liste; 'kat_plani' = kat plani) + property_media.caption text (1-80 karakter).
--   Kat plani ayri bir `kind` DEGILDIR: kind = 'image' kalir; public servis uclari, portal aktarimi ve KVKK belge kurali
--   (is_document) degismeden kat planini da kapsar. Etiket listesi kodsal ROOM_TAGS ile BIREBIR aynidir
--   (sozlesme testi: src/lib/media/room-tags.test.ts).
-- RLS: DEGISMEZ (property_media_tenant "for all" tenant kosulu aynen); yazma mevcut ofis ici action'lar uzerinden.
-- VERI: mevcut satirlar NULL kalir (etiketsiz fotograf). Sutun eklemek hizli varsayilandir (tablo yeniden yazilmaz).
-- BAGIMSIZ: KOD YAYININDAN ONCE ya da SONRA uygulanabilir; kod sutunlar yokken etiket/aciklama alanlarini gizler ve galeri
--   eskisi gibi calisir (src/lib/media/meta-query.ts selectWithMediaMeta). Transaction-uyumlu; tekrar calistirilabilir.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.property_media') is null then
    raise exception '20261019030000: public.property_media yok.';
  end if;
end
$$;

alter table public.property_media add column if not exists room_tag text;
alter table public.property_media add column if not exists caption text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass and conname = 'property_media_room_tag_check'
  ) then
    alter table public.property_media
      add constraint property_media_room_tag_check
      check (room_tag is null or room_tag in (
        'salon', 'oturma_odasi', 'mutfak', 'yatak_odasi', 'cocuk_odasi', 'calisma_odasi', 'banyo', 'wc', 'antre',
        'koridor', 'balkon', 'teras', 'bahce', 'cephe', 'manzara', 'havuz', 'otopark', 'ortak_alan', 'kat_plani'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass and conname = 'property_media_caption_check'
  ) then
    alter table public.property_media
      add constraint property_media_caption_check
      check (caption is null or char_length(caption) between 1 and 80);
  end if;
end
$$;

comment on column public.property_media.room_tag is
  'Oda etiketi (salon, mutfak, yatak_odasi...). ''kat_plani'' = kat plani: public yuzeylerde ayri sekmede gosterilir, kapak olmaz. Kod tek kaynak: src/lib/media/room-tags.ts ROOM_TAGS.';
comment on column public.property_media.caption is
  'Gorsel aciklamasi (1-80 karakter): alt metin ve galeri altyazisi. Bos = oda etiketi kullanilir.';
