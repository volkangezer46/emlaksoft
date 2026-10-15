-- Geri alma: 20261019030000_property_media_room_tag_caption.sql
-- Oda etiketi ve aciklama sutunlari (CHECK'leriyle) duser. Kod sutunlar yokken etiket/aciklama alanlarini gizler; kat
-- planlari siradan fotograf olarak gorunmeye devam eder (gorsel silinmez). Baska nesneye dokunmaz.
alter table public.property_media drop constraint if exists property_media_room_tag_check;
alter table public.property_media drop constraint if exists property_media_caption_check;
alter table public.property_media drop column if exists room_tag;
alter table public.property_media drop column if exists caption;
