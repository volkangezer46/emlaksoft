-- Ofis Merkezi: havuzdan danisman atama gecmisi (pool_assignments).
--
-- AMAC: ofis sahibinin (veya yetki verdigi calisanin) bir ilani danismana ATAMASININ kalici kaydi: kim, kime, hangi
-- yontemle (manual | smart | rule), hangi puan/gerekceyle; iptal/yeniden atama durumu. listing_pool_entries (havuz
-- kuyrugu) ve properties.assigned_to'ya DOKUNMAZ; onlar is akisinin kendisidir, bu tablo denetlenebilir gecmistir.
-- Ayni ilan icin aynı anda TEK 'active' satir olur (kismi benzersiz indeks): yeniden atama onceki satiri 'reassigned'
-- yapar, iptal 'cancelled' yapar. Silme yoktur (authenticated DELETE yetkisi verilmez).
-- score jsonb: {total, reasons:[{key,label,points,max}]} — KISISEL VERI ICERMEZ.
--
-- RLS: okuma = ayni ofis + (office_center view izni VEYA atanan kisinin kendisi); yazma = ayni ofis + office_center edit
--   izni (has_effective_permission: permission_defaults seed'i 20261006000500 SARTTIR). service_role tam yetkili.
-- BAGIMLILIK: 20261006000500 (seed), public.properties (id, tenant_id) benzersiz (idx_properties_id_tenant_unique),
--   public.profiles (id, tenant_id), public.listing_pool_entries (20260816001500), has_effective_permission(text,text).
-- GERI ALMA: rollbacks/20261006000510_pool_assignments.rollback.sql (gecmis silinir; properties.assigned_to kalir).
-- RISK: dusuk (yalniz yeni tablo + RLS; mevcut davranis degismez). Kod tablo yokken "gecmis etkin degil" ile calisir.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null or pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'properties/profiles yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception 'current_tenant_id()/has_effective_permission(text,text) yok.';
  end if;
  if not exists (select 1 from public.permission_defaults where module = 'office_center' and role = 'owner') then
    raise exception 'office_center permission_defaults seed''i (20261006000500) uygulanmamis.';
  end if;
end $$;

create table if not exists public.pool_assignments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  property_id         uuid not null,
  from_pool_id        uuid references public.listing_pool_entries(id) on delete set null,
  assigned_to         uuid not null,
  previous_assignee   uuid references public.profiles(id) on delete set null,
  assigned_by         uuid references public.profiles(id) on delete set null,
  method              text not null check (method in ('manual', 'smart', 'rule')),
  score               jsonb not null default '{}'::jsonb,
  reason              text check (reason is null or char_length(reason) <= 500),
  status              text not null default 'active' check (status in ('active', 'cancelled', 'reassigned')),
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles(id) on delete set null,
  cancel_reason       text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_at          timestamptz not null default now(),
  constraint pool_assignments_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties (id, tenant_id) on delete cascade,
  constraint pool_assignments_assignee_tenant_fkey
    foreign key (assigned_to, tenant_id) references public.profiles (id, tenant_id) on delete cascade,
  constraint pool_assignments_cancel_consistency check (
    (status = 'cancelled' and cancelled_at is not null) or (status <> 'cancelled' and cancelled_at is null)
  )
);

create unique index if not exists uq_pool_assignments_active_per_property
  on public.pool_assignments (property_id) where status = 'active';
create index if not exists idx_pool_assignments_tenant_created
  on public.pool_assignments (tenant_id, status, created_at desc);
create index if not exists idx_pool_assignments_tenant_property
  on public.pool_assignments (tenant_id, property_id);
create index if not exists idx_pool_assignments_tenant_assignee
  on public.pool_assignments (tenant_id, assigned_to) where status = 'active';

alter table public.pool_assignments enable row level security;

drop policy if exists pool_assignments_select on public.pool_assignments;
create policy pool_assignments_select on public.pool_assignments for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and ((select public.has_effective_permission('office_center', 'view')) or assigned_to = (select auth.uid()))
);

drop policy if exists pool_assignments_insert on public.pool_assignments;
create policy pool_assignments_insert on public.pool_assignments for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('office_center', 'edit'))
  and assigned_by = (select auth.uid())
);

drop policy if exists pool_assignments_update on public.pool_assignments;
create policy pool_assignments_update on public.pool_assignments for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('office_center', 'edit'))
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('office_center', 'edit'))
);

revoke all on table public.pool_assignments from public, anon;
grant select, insert, update on table public.pool_assignments to authenticated;
grant all on table public.pool_assignments to service_role;

comment on table public.pool_assignments is
  'Ofis Merkezi atama gecmisi: ilan -> danisman atamasi (manual|smart|rule), puan/gerekce, iptal/yeniden atama. Silinmez.';

notify pgrst, 'reload schema';
