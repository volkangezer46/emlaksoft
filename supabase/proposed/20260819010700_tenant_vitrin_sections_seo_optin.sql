-- Vitrin ayar ekranı v2 taslağı (UYGULANMADI). 20260816060100_tenant_vitrin_settings.sql taslağının TAMAMLAYICISIDIR:
-- o dosya vitrin_intro / vitrin_enabled / vitrin_show_phone sütunlarını ekler; bu dosya şunları ekler:
--   vitrin_seo_optin       : true ise ofis vitrini arama motoru site haritasına girer (varsayılan FALSE = kapalı).
--                            src/lib/seo/sitemap-data.ts opt-in kaynağı BU sütundur (elle slug listesi yerine).
--   vitrin_show_lead_form  : false ise vitrinde talep formu bölümü gizlenir (varsayılan true)
--   vitrin_show_valuation  : false ise vitrinde "ücretsiz değerleme" bağlantısı gizlenir (varsayılan true)
-- SIRA: önce 20260816060100 sonra bu dosya. İkisi de uygulanana kadar ayar ekranı "etkin değil" uyarısı gösterir ve
-- public vitrin davranışı değişmez (okuma tek sorguda yapılır, sütun yoksa varsayılanlara düşer).
-- NUMARA: 20260816060100 mevcut migration'lardan eski bir numaradır; terfi ettirilirken yeni numara almalıdır
-- (forward-only denetimi). Forward-only; rollback dosyası yanında. RLS: tenants mevcut politikaları geçerli.

alter table public.tenants
  add column if not exists vitrin_seo_optin boolean not null default false,
  add column if not exists vitrin_show_lead_form boolean not null default true,
  add column if not exists vitrin_show_valuation boolean not null default true;

comment on column public.tenants.vitrin_seo_optin is 'true: ofis vitrini sitemap''e girer (ofis sahibinin açık onayı); varsayılan false';
comment on column public.tenants.vitrin_show_lead_form is 'false: vitrinde talep formu gizlenir';
comment on column public.tenants.vitrin_show_valuation is 'false: vitrinde değerleme bağlantısı gizlenir';
