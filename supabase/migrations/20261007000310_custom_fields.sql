-- Ozel alanlar (custom fields): ofis kendi alanlarini tanimlar (metin / sayi / tarih / secim / evet-hayir) —
-- musteri, portfoy, talep ve anlasma kayitlari icin.
--
-- TABLOLAR:
--   custom_field_defs   : ofis basina alan tanimi (entity + key benzersiz). Yazma yalniz ayarlar:edit (owner/gm varsayilan).
--   custom_field_values : kayit basina deger (def_id + record_id PK). entity/tenant tanimla bileşik FK ile tutarli.
-- RLS:
--   * defs okuma: ayni ofis. defs yazma: ayni ofis + has_effective_permission('settings','edit').
--   * values okuma: ayni ofis + UST KAYIT kullaniciya gorunur (EXISTS, alt sorguda ust tablonun RLS'i calisir) —
--     boylece degerler, kullanicinin goremedigi musteri/portfoy/anlasma uzerinden sizmaz.
--   * values yazma: ayni ofis + ust kayit gorunur + ilgili modulde edit (eklemede create da yeter):
--     customer -> customers, property -> properties, demand -> demands, deal -> commissions.
-- KISITLAR: deger tek sutunda (num_nonnulls <= 1), metin <= 2000, secenekler jsonb dizi. Kayit silinince (soft delete)
--   deger kalir; kayit geri alininca yine gorunur. Ofis basina varlik basina en cok 30 tanim uygulama katmaninda.
-- BAGIMLILIK: current_tenant_id(), has_effective_permission(text,text), customers/properties/customer_demands/deals.
-- GERI ALMA: rollbacks/20261007000310_custom_fields.rollback.sql (tanimlar ve DEGERLER silinir).
-- RISK: dusuk (yalniz yeni tablolar). Kod tablolar yokken ozel alan bolumlerini gizler ("etkin degil").

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception 'current_tenant_id()/has_effective_permission(text,text) yok.';
  end if;
  if pg_catalog.to_regclass('public.customers') is null or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.customer_demands') is null or pg_catalog.to_regclass('public.deals') is null then
    raise exception 'customers/properties/customer_demands/deals yok.';
  end if;
end $$;

create table if not exists public.custom_field_defs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  entity      text not null check (entity in ('customer', 'property', 'demand', 'deal')),
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  field_type  text not null check (field_type in ('text', 'number', 'date', 'select', 'boolean')),
  options     jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 50),
  required    boolean not null default false,
  position    integer not null default 0 check (position between 0 and 999),
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint custom_field_defs_select_has_options check (field_type <> 'select' or jsonb_array_length(options) >= 1),
  constraint custom_field_defs_unique_key unique (tenant_id, entity, key),
  constraint custom_field_defs_id_tenant_entity unique (id, tenant_id, entity)
);

create index if not exists idx_custom_field_defs_tenant_entity
  on public.custom_field_defs (tenant_id, entity, position) where active;

create table if not exists public.custom_field_values (
  def_id      uuid not null,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  entity      text not null check (entity in ('customer', 'property', 'demand', 'deal')),
  record_id   uuid not null,
  value_text  text check (value_text is null or char_length(value_text) <= 2000),
  value_num   numeric,
  value_date  date,
  value_bool  boolean,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (def_id, record_id),
  constraint custom_field_values_def_fkey
    foreign key (def_id, tenant_id, entity) references public.custom_field_defs (id, tenant_id, entity) on delete cascade,
  constraint custom_field_values_single_value check (num_nonnulls(value_text, value_num, value_date, value_bool) <= 1)
);

create index if not exists idx_custom_field_values_record
  on public.custom_field_values (tenant_id, entity, record_id);

alter table public.custom_field_defs enable row level security;
alter table public.custom_field_values enable row level security;

-- ---------------------------------------------------------------- defs
drop policy if exists custom_field_defs_select on public.custom_field_defs;
create policy custom_field_defs_select on public.custom_field_defs for select to authenticated
using (tenant_id = (select public.current_tenant_id()));

drop policy if exists custom_field_defs_insert on public.custom_field_defs;
create policy custom_field_defs_insert on public.custom_field_defs for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists custom_field_defs_update on public.custom_field_defs;
create policy custom_field_defs_update on public.custom_field_defs for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists custom_field_defs_delete on public.custom_field_defs;
create policy custom_field_defs_delete on public.custom_field_defs for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

-- ---------------------------------------------------------------- values
-- Ust kayit gorunurlugu: alt sorgu INVOKER calisir, ust tablonun RLS'i uygulanir.
create or replace function public.custom_field_record_visible(p_entity text, p_record_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case p_entity
    when 'customer' then exists (select 1 from public.customers c where c.id = p_record_id)
    when 'property' then exists (select 1 from public.properties p where p.id = p_record_id)
    when 'demand'   then exists (select 1 from public.customer_demands d where d.id = p_record_id)
    when 'deal'     then exists (select 1 from public.deals x where x.id = p_record_id)
    else false
  end;
$$;

create or replace function public.custom_field_can_write(p_entity text, p_insert boolean)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case p_entity
    when 'customer' then public.has_effective_permission('customers', 'edit') or (p_insert and public.has_effective_permission('customers', 'create'))
    when 'property' then public.has_effective_permission('properties', 'edit') or (p_insert and public.has_effective_permission('properties', 'create'))
    when 'demand'   then public.has_effective_permission('demands', 'edit') or (p_insert and public.has_effective_permission('demands', 'create'))
    when 'deal'     then public.has_effective_permission('commissions', 'edit') or (p_insert and public.has_effective_permission('commissions', 'create'))
    else false
  end;
$$;

revoke all on function public.custom_field_record_visible(text, uuid) from public, anon;
revoke all on function public.custom_field_can_write(text, boolean) from public, anon;
grant execute on function public.custom_field_record_visible(text, uuid) to authenticated, service_role;
grant execute on function public.custom_field_can_write(text, boolean) to authenticated, service_role;

drop policy if exists custom_field_values_select on public.custom_field_values;
create policy custom_field_values_select on public.custom_field_values for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and public.custom_field_record_visible(entity, record_id));

drop policy if exists custom_field_values_insert on public.custom_field_values;
create policy custom_field_values_insert on public.custom_field_values for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and public.custom_field_record_visible(entity, record_id)
  and public.custom_field_can_write(entity, true)
  and updated_by = (select auth.uid())
);

drop policy if exists custom_field_values_update on public.custom_field_values;
create policy custom_field_values_update on public.custom_field_values for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and public.custom_field_record_visible(entity, record_id) and public.custom_field_can_write(entity, false))
with check (
  tenant_id = (select public.current_tenant_id())
  and public.custom_field_record_visible(entity, record_id)
  and public.custom_field_can_write(entity, false)
  and updated_by = (select auth.uid())
);

drop policy if exists custom_field_values_delete on public.custom_field_values;
create policy custom_field_values_delete on public.custom_field_values for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and public.custom_field_record_visible(entity, record_id) and public.custom_field_can_write(entity, false));

revoke all on table public.custom_field_defs from public, anon;
revoke all on table public.custom_field_values from public, anon;
grant select, insert, update, delete on table public.custom_field_defs to authenticated;
grant select, insert, update, delete on table public.custom_field_values to authenticated;
grant all on table public.custom_field_defs to service_role;
grant all on table public.custom_field_values to service_role;

comment on table public.custom_field_defs is 'Ofis ozel alan tanimlari (musteri/portfoy/talep/anlasma). Yazma: ayarlar:edit.';
comment on table public.custom_field_values is 'Ozel alan degerleri; okuma ust kayit gorunurluguyle, yazma ilgili modul edit izniyle.';

notify pgrst, 'reload schema';
