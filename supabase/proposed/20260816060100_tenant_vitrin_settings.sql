-- K6 / F7 taslağı (UYGULANMADI): ofis vitrin ayarları — tanıtım metni ve görünürlük.
--
-- Şemada bugün yalnız logo_url, brand_color, phone ve lead_capture_enabled var; vitrin tanıtım metni ve
-- vitrini kapatma/adres gizleme karşılıksızdı. Bu dosya üç ofis-düzeyi ayar ekler:
--   vitrin_intro        : vitrin başlığı altındaki kısa tanıtım (<= 600 karakter), null = gösterme
--   vitrin_enabled      : false ise public vitrin 404 döner (varsayılan true)
--   vitrin_show_phone   : false ise vitrinde ofis telefonu gösterilmez (varsayılan true)
-- DİKKAT: Bu sütunları OKUYAN taraf public vitrin (src/app/vitrin/[slug], K4 sahipliği) ve ayar ekranıdır.
-- Public okuma güncellenmeden ayar ekranı eklenmemelidir (boş vaat). Forward-only; rollback dosyası yanında.
-- RLS: tenants tablosunun mevcut politikaları geçerlidir; yeni politika gerekmez.

alter table public.tenants
  add column if not exists vitrin_intro text,
  add column if not exists vitrin_enabled boolean not null default true,
  add column if not exists vitrin_show_phone boolean not null default true;

alter table public.tenants
  drop constraint if exists tenants_vitrin_intro_len;
alter table public.tenants
  add constraint tenants_vitrin_intro_len check (vitrin_intro is null or char_length(vitrin_intro) <= 600);

comment on column public.tenants.vitrin_intro is 'Public vitrin tanıtım metni (<=600); null = gösterilmez';
comment on column public.tenants.vitrin_enabled is 'false: public vitrin kapalı';
comment on column public.tenants.vitrin_show_phone is 'false: vitrinde ofis telefonu gizlenir';
