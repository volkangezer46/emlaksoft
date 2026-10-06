-- MIGRATION 20260826002950_property_eids_no.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002950_property_eids_no.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002950_property_eids_no.rollback.sql
-- BAGIMLILIK: public.properties. On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (H2): EIDS Tasinmaz Kimlik Numarasi. Mal sahibi e-Devlet "EIDS Yetki Islemleri"nde yetkiyi onaylayinca uretilen numara
-- portfoyde tutulur; ilan kontrol saglik skorundaki `eids` bileseni ve Uyum merkezi EIDS ozeti bu alani olcer.
-- Resmi bicim dogrulanamadi: yalniz gevsek kisit (BUYUK harf/rakam/tire, 6-24 karakter; uygulama normalize eder).
-- Bu bir RESMI SORGULAMA DEGILDIR. Yalniz IKI ekleme (1 nullable sutun + indeks); mevcut satir/RLS degismez.
-- Kod sutun yokken zarifce atlar (okuma hatasi yutulur, olcum "olculemedi" kalir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null then
    raise exception 'properties yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.properties add column if not exists eids_property_no text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_eids_property_no_format_check') then
    alter table public.properties
      add constraint properties_eids_property_no_format_check
      check (eids_property_no is null or eids_property_no ~ '^[A-Z0-9-]{6,24}$');
  end if;
end $$;

comment on column public.properties.eids_property_no is
  'EIDS Tasinmaz Kimlik Numarasi (elle giris, normalize edilmis). Resmi dogrulama degildir.';

create index if not exists idx_properties_eids_no
  on public.properties (tenant_id, eids_property_no)
  where eids_property_no is not null;
