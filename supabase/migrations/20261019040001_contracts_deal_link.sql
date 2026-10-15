-- MIGRATION 20261019040001_contracts_deal_link.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: sutunlar yokken anlasmadan/tekliften sozlesme yine olusur, yalniz
--   kesin bag yazilmaz (kod 42703'te bagsiz yazar) ve anlasma sayfasi eski portfoy+musteri eslesmesine duser.
-- Geri alma: supabase/rollbacks/20261019040001_contracts_deal_link.rollback.sql
-- BAGIMLILIK: public.contracts, public.deals (+ idx_deals_id_tenant_unique), public.offers (+ idx_offers_id_tenant_unique).
--
-- NE (SP3): sozlesme <-> anlasma / kabul edilen teklif kesin bagi.
--   contracts.deal_id, contracts.offer_id: nullable, ayni ofis zorunlu (bilesik FK), anlasma/teklif silinirse bag kopar,
--   sozlesme KALIR. Var olan sozlesmeler icin TEK anlamli eslesme (ayni ofis + portfoy + musteri ile tam bir anlasma)
--   bir kerelik doldurulur; birden cok aday varsa bag yazilmaz (yanlis bag kurulmasin).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.contracts') is null
     or pg_catalog.to_regclass('public.deals') is null
     or pg_catalog.to_regclass('public.offers') is null then
    raise exception 'contracts/deals/offers yok; once temel migrationlar uygulanmali.';
  end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_deals_id_tenant_unique') then
    raise exception 'idx_deals_id_tenant_unique yok; tenant sinir migrationi once uygulanmali.';
  end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_offers_id_tenant_unique') then
    raise exception 'idx_offers_id_tenant_unique yok; tenant sinir migrationi once uygulanmali.';
  end if;
end $$;

alter table public.contracts add column if not exists deal_id uuid;
alter table public.contracts add column if not exists offer_id uuid;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_deal_tenant_fkey') then
    alter table public.contracts
      add constraint contracts_deal_tenant_fkey
      foreign key (deal_id, tenant_id)
      references public.deals(id, tenant_id)
      on delete set null (deal_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_offer_tenant_fkey') then
    alter table public.contracts
      add constraint contracts_offer_tenant_fkey
      foreign key (offer_id, tenant_id)
      references public.offers(id, tenant_id)
      on delete set null (offer_id);
  end if;
end $$;

create index if not exists idx_contracts_deal on public.contracts (tenant_id, deal_id) where deal_id is not null;
create index if not exists idx_contracts_offer on public.contracts (tenant_id, offer_id) where offer_id is not null;

comment on column public.contracts.deal_id is 'SP3: bagli anlasma (anlasmadan/kabul edilen tekliften hazirlanan sozlesme). Anlasma silinirse null.';
comment on column public.contracts.offer_id is 'SP3: sozlesmenin dayandigi kabul edilmis teklif. Teklif silinirse null.';

-- Bir kerelik geri doldurma: yalniz tek aday anlasma varsa (service_role baglaminda calisir; yasam dongusu tetigi
-- yalniz authenticated rolu engeller).
with candidates as (
  select c.id as contract_id, (array_agg(d.id order by d.created_at desc))[1] as deal_id, count(*) as n
  from public.contracts c
  inner join public.deals d
    on d.tenant_id = c.tenant_id
   and d.property_id = c.property_id
   and d.customer_id = c.customer_id
  where c.deal_id is null
    and c.property_id is not null
    and c.customer_id is not null
  group by c.id
)
update public.contracts c
   set deal_id = candidates.deal_id
  from candidates
 where candidates.contract_id = c.id
   and candidates.n = 1
   and c.deal_id is null;
