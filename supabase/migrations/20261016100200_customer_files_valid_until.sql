-- MIGRATION 20261016100200_customer_files_valid_until.sql
-- P4 (2026-10-16): musteri belgelerinde gecerlilik (son kullanma) tarihi.
-- Geri alma: supabase/rollbacks/20261016100200_customer_files_valid_until.rollback.sql (girilen gecerlilik tarihleri KAYBOLUR;
--   kod sutun yokken belge listesini tarihsiz gosterir, ?gecerlilik= filtresi bos doner, document_expiry@1 kurali "etkin degil" sayilir).
-- BAGIMLILIK: 20260722000010_customer_files.sql (customer_files).
--
-- NE: customer_files.valid_until date NULL (opsiyonel; kimlik, DASK, ekspertiz gibi suresi olan belgeler icin)
--   + yalniz dolu satirlar icin kismi indeks (tenant_id, valid_until).
-- NEDEN: Belge merkezinde "yaklasan / gecmis" filtresi ve rozeti, icgoru kurali (document_expiry@1) icin.
-- GUVENLIK: tablo RLS'i (customer_files_tenant) ve yetkileri degismez; yeni sutun ayni politikayla korunur.
-- ETKI: yalniz ek (nullable sutun + indeks). Mevcut satir/politika/davranis degismez. Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.customer_files') is null then
    raise exception 'customer_files yok: once 20260722000010_customer_files.sql uygulanmali.';
  end if;
end $$;

alter table public.customer_files
  add column if not exists valid_until date;

create index if not exists idx_customer_files_valid_until
  on public.customer_files (tenant_id, valid_until)
  where valid_until is not null;

comment on column public.customer_files.valid_until is
  'Belgenin gecerlilik (son kullanma) tarihi; bos = suresiz. Belge merkezi ?gecerlilik= filtresi ve document_expiry@1 icgorusu okur.';

notify pgrst, 'reload schema';
