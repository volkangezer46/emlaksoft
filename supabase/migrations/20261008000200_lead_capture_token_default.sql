-- Vitrin talep formu tokeni her ofiste olsun (konsey Dalga 1 persona KRİTİK bulgusu).
--
-- NEDEN: lead_capture_token yalnız 20260722000020 anında var olan ofislere üretilmişti; sütunun varsayılanı yok.
--   Sonradan açılan ofislerde (kayıt, admin ofis açma, demo-ofis) token NULL kaldığından vitrin ilan detayında talep
--   formu "kapalı" çiziliyor ve müşteri ofise form ile ulaşamıyordu (2026-10-08 salt-okunur sayım: 5 ofisten 4'ü NULL).
-- NE: (1) sütuna güvenli rastgele varsayılan (32 hex, rotate_lead_capture_token kuralına uygun: >=32, [A-Za-z0-9._~-]);
--     (2) NULL olan ofislere token üretilir. lead_capture_enabled DEĞİŞMEZ (ofis kapattıysa kapalı kalır).
-- GERI ALMA: rollbacks/20261008000200_lead_capture_token_default.rollback.sql (varsayılan kalkar; üretilen tokenler kalır).
-- RISK: düşük (yalnız NULL satırlar; benzersiz indeks tenants_lead_capture_token_key mevcut).

set local lock_timeout = '5s';

alter table public.tenants
  alter column lead_capture_token set default replace(gen_random_uuid()::text, '-', '');

update public.tenants
   set lead_capture_token = replace(gen_random_uuid()::text, '-', '')
 where lead_capture_token is null;
