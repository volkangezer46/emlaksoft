-- MIGRATION 20260826001800_tenant_license_details.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001800_tenant_license_details.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001800_tenant_license_details.rollback.sql
-- BAGIMLILIK: public.tenants (license_no zaten var). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC: yetki belgesi unvani ve gecerlilik tarihi (ofis ayari + sure bitimi uyarisi). Yalniz IKI nullable sutun eklenir;
-- mevcut satir/davranis degismez. Kod sutunlar yokken zarifce atlar (kaydetmede/okumada hata yutulur, uyari gosterilir).
-- Hukuki dayanak notu: docs/MEVZUAT_SABITLERI.md (yetki belgesi ilan zorunlulugu) - AVUKAT TEYIDI GEREKIR.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'tenants yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.tenants add column if not exists license_title text;
alter table public.tenants add column if not exists license_valid_until date;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'tenants_license_title_len_check') then
    alter table public.tenants
      add constraint tenants_license_title_len_check
      check (license_title is null or char_length(license_title) <= 200);
  end if;
end $$;
