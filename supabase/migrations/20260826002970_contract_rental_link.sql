-- MIGRATION 20260826002970_contract_rental_link.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002970_contract_rental_link.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002970_contract_rental_link.rollback.sql
-- BAGIMLILIK: public.contracts, public.rentals (+ idx_rentals_id_tenant_unique). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (H6): kiralama kaydindan tek tikla kira sozlesmesi. contracts <-> rentals iki yonlu baglanir:
--  * contracts.rental_id (nullable, kiralama silinirse baglanti kopar, sozlesme KALIR)
--  * contracts.rent_increase_basis ('tufe' | 'sabit' | 'yok') + rent_increase_fixed_pct: artis maddesi alani
-- Yalniz nullable ekler; mevcut satir/davranis/RLS degismez. Kod sutunlar yokken zarifce atlar.
-- Metin yer tutucudur; hukuki gecerlilik/e-imza iddiasi YOKTUR (ofisin kendi onayli sablonu da kullanilabilir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.contracts') is null or pg_catalog.to_regclass('public.rentals') is null then
    raise exception 'contracts/rentals yok; once temel migrationlar uygulanmali.';
  end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_rentals_id_tenant_unique') then
    raise exception 'idx_rentals_id_tenant_unique yok; 20260809000020 once uygulanmali.';
  end if;
end $$;

alter table public.contracts add column if not exists rental_id uuid;
alter table public.contracts add column if not exists rent_increase_basis text;
alter table public.contracts add column if not exists rent_increase_fixed_pct numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_rental_tenant_fkey') then
    alter table public.contracts
      add constraint contracts_rental_tenant_fkey
      foreign key (rental_id, tenant_id)
      references public.rentals(id, tenant_id)
      on delete set null (rental_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_rent_increase_basis_check') then
    alter table public.contracts
      add constraint contracts_rent_increase_basis_check
      check (rent_increase_basis is null or rent_increase_basis in ('tufe', 'sabit', 'yok'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_rent_increase_pct_check') then
    alter table public.contracts
      add constraint contracts_rent_increase_pct_check
      check (rent_increase_fixed_pct is null or (rent_increase_fixed_pct >= 0 and rent_increase_fixed_pct <= 100));
  end if;
end $$;

create index if not exists idx_contracts_rental on public.contracts (tenant_id, rental_id) where rental_id is not null;

comment on column public.contracts.rental_id is 'Bagli kiralama kaydi (kiralamadan olusturulan kira sozlesmesi). Kiralama silinirse null olur.';
comment on column public.contracts.rent_increase_basis is 'Kira artis maddesi: tufe (12 aylik ortalama, TBK m.344) | sabit (yuzde) | yok';
