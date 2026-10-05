-- MIGRATION 20260825001200 (2026-10-05 terfi; eski taslak adı proposed/20260819010700_tenant_vitrin_sections_seo_optin.sql).
-- UYGULANMADI: yalnız restore edilebilir backup/PITR doğrulandıktan sonra SAHİBİ
-- `npm run db:migrate -- --only 20260825001200_tenant_vitrin_sections_seo_optin.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260825001200_tenant_vitrin_sections_seo_optin.rollback.sql.
-- Vitrin ayar ekranı v2. 20260825001100_tenant_vitrin_settings.sql (eski 20260816060100) dosyasının TAMAMLAYICISIDIR:
-- o dosya vitrin_intro / vitrin_enabled / vitrin_show_phone sütunlarını ekler; bu dosya şunları ekler:
--   vitrin_seo_optin       : true ise ofis vitrini arama motoru site haritasına girer (varsayılan FALSE = kapalı).
--                            src/lib/seo/sitemap-data.ts opt-in kaynağı BU sütundur (elle slug listesi yerine).
--   vitrin_show_lead_form  : false ise vitrinde talep formu bölümü gizlenir (varsayılan true)
--   vitrin_show_valuation  : false ise vitrinde "ücretsiz değerleme" bağlantısı gizlenir (varsayılan true)
-- SIRA: önce 20260825001100 sonra bu dosya. İkisi de uygulanana kadar ayar ekranı "etkin değil" uyarısı gösterir ve
-- public vitrin davranışı değişmez (okuma tek sorguda yapılır, sütun yoksa varsayılanlara düşer).
-- Forward-only. RLS: tenants mevcut politikaları geçerli.
-- DAVRANIŞ DEĞİŞİKLİĞİ (terfi notu): sütun oluşunca sitemap-data.ts (resolveOptInSlugs) platform_settings
-- 'seo.sitemap'.optInTenantSlugs ELLE listesini YOK SAYAR; yalnız vitrin_seo_optin=true ofisler girer (hepsi false doğar).
-- onlyOptIn=true iken elle listede olan vitrinler sitemap'ten DÜŞER. Ofis sahibinin açık onayı ilkesi gereği bu dosya
-- otomatik doldurma YAPMAZ; uygulamadan önce salt-okunur liste ve sonrası karar: docs/runbooks/YAYIN_PENCERESI_2.md.

alter table public.tenants
  add column if not exists vitrin_seo_optin boolean not null default false,
  add column if not exists vitrin_show_lead_form boolean not null default true,
  add column if not exists vitrin_show_valuation boolean not null default true;

comment on column public.tenants.vitrin_seo_optin is 'true: ofis vitrini sitemap''e girer (ofis sahibinin açık onayı); varsayılan false';
comment on column public.tenants.vitrin_show_lead_form is 'false: vitrinde talep formu gizlenir';
comment on column public.tenants.vitrin_show_valuation is 'false: vitrinde değerleme bağlantısı gizlenir';
