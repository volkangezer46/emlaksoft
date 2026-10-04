-- TASLAK (UYGULANMADI) — ONERI Ö-5 / BIRLESIK U-18: malik-musteri baglantisi.
-- properties.owner_customer_id (nullable) -> customers.id. Mevcut satirlara DOKUNMAZ.
--
-- UYGULAMADAN ONCE:
--  1) PostgREST: properties <-> customers arasinda ikinci bir FK olusur. properties'ten customers'a
--     gomen HER sorgu FK ipucuyla yazilmali (`alias:customers!properties_<kolon>_fkey(...)`);
--     src/lib/postgrest-embed-hint-contract.test.ts YESIL olmali, ipucusuz gomme listeyi sessizce bosaltir.
--  2) Yazma tarafi (ilan sahibi sekmesi, atama) P-HAVUZ ajaninin src/lib/property-owner/** dosyalarindadir;
--     bu migration yalniz kolonu hazirlar. Okuma tarafi src/lib/owner-link/read.ts kolon yokken kendini gizler.
--  3) Restore edilebilir yedek/PITR dogrulanmadan canliya uygulanmaz; once `npm run db:migrate -- --dry-run`.
-- Forward-only, yeniden calistirilabilir.

alter table public.properties
  add column if not exists owner_customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_owner_customer_id_fkey'
      and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_owner_customer_id_fkey
      foreign key (owner_customer_id) references public.customers(id) on delete set null;
  end if;
end $$;

create index if not exists idx_properties_owner_customer
  on public.properties (tenant_id, owner_customer_id)
  where owner_customer_id is not null;

-- Tenant sizintisi onleme: malik musteri ayni ofise ait olmali (service_role dahil her yazimda).
create or replace function public.properties_owner_same_tenant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.owner_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.owner_customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'owner_customer_id baska bir ofise ait' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_properties_owner_same_tenant on public.properties;
create trigger trg_properties_owner_same_tenant
  before insert or update of owner_customer_id on public.properties
  for each row execute function public.properties_owner_same_tenant();
