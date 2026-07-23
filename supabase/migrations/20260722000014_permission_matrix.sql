-- DB-tabanlı yetkilendirme mimarisi (rol × modül × aksiyon)
-- permission_defaults: src/lib/permissions.ts MATRIX'inin salt-okunur DB kopyası (referans + RLS için).
--   MATRIX değişirse bu tablo da senkron güncellenmeli (bkz. dosya başındaki not).
-- tenant_role_permissions: ofis (tenant) bazlı override'lar. Bir satır varsa onun `allowed` değeri geçerlidir;
--   yoksa permission_defaults'taki varsayılan (o üçlü mevcutsa izinli, yoksa izinsiz) geçerlidir.

create table if not exists public.permission_defaults (
  role text not null,
  module text not null,
  action text not null,
  primary key (role, module, action)
);

comment on table public.permission_defaults is
  'src/lib/permissions.ts MATRIX''in DB yansıması — varsayılan rol×modül×aksiyon izinleri. Sadece migration ile değişir.';

create table if not exists public.tenant_role_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null,
  module text not null,
  action text not null,
  allowed boolean not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, role, module, action)
);

create index if not exists idx_tenant_role_permissions_tenant on public.tenant_role_permissions(tenant_id);

comment on table public.tenant_role_permissions is
  'Ofise özel izin override''ları. allowed=true → varsayılanın üstüne izin ekler, allowed=false → varsayılan izni kaldırır.';

alter table public.tenant_role_permissions enable row level security;

-- Herkes (authenticated) kendi tenant'ının override'larını okuyabilir (etkin izin hesaplaması için gerekli).
create policy tenant_role_permissions_read on public.tenant_role_permissions for select
  using (tenant_id = public.current_tenant_id());

-- Sadece owner/gm yazabilir (yetki yönetim ekranı bu rollerle sınırlı).
create policy tenant_role_permissions_write on public.tenant_role_permissions for all
  using (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'))
  with check (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'));

grant select on public.tenant_role_permissions to authenticated;
grant all on public.tenant_role_permissions to service_role;

-- ========== permission_defaults seed (src/lib/permissions.ts MATRIX ile birebir) ==========

truncate table public.permission_defaults;

insert into public.permission_defaults (role, module, action)
select 'owner', m, a
from unnest(array[
  'dashboard','customers','demands','properties','matching','portals','leak',
  'appointments','calls','commissions','team','support','settings','billing',
  'reports','valuation','compliance'
]) m, unnest(array['view','create','edit','delete']) a
union all
select 'gm', m, a
from unnest(array[
  'dashboard','customers','demands','properties','matching','portals','leak',
  'appointments','calls','commissions','support','valuation','compliance'
]) m, unnest(array['view','create','edit','delete']) a
union all
select 'gm', m, a
from unnest(array['team','settings','billing']) m, unnest(array['view','create','edit']) a
union all
select 'gm', 'reports', 'view'
union all
select 'branch_manager', m, 'view'
from unnest(array['dashboard','leak','commissions','team','reports']) m
union all
select 'branch_manager', m, a
from unnest(array['customers','demands','properties','matching','portals','appointments','calls']) m,
     unnest(array['view','create','edit','delete']) a
union all
select 'branch_manager', m, a
from unnest(array['support','valuation']) m, unnest(array['view','create','edit']) a
union all
select 'team_lead', m, 'view'
from unnest(array['dashboard','commissions','support','valuation']) m
union all
select 'team_lead', m, a
from unnest(array['customers','demands','properties','matching','appointments','calls']) m,
     unnest(array['view','create','edit','delete']) a
union all
select 'team_lead', 'portals', a from unnest(array['view','create','edit']) a
union all
select 'advisor', m, 'view'
from unnest(array['dashboard','leak','commissions','support','settings','reports','valuation','compliance']) m
union all
select 'advisor', m, a
from unnest(array['customers','demands','properties','matching','portals','appointments','calls']) m,
     unnest(array['view','create','edit']) a
union all
select 'call_center', m, 'view' from unnest(array['dashboard','support']) m
union all
select 'call_center', m, a
from unnest(array['customers','demands','appointments']) m, unnest(array['view','create','edit']) a
union all
select 'call_center', 'calls', a from unnest(array['view','create','edit','delete']) a
union all
select 'accounting', m, 'view' from unnest(array['dashboard','customers','reports','support']) m
union all
select 'accounting', 'commissions', a from unnest(array['view','create','edit','delete']) a
union all
select 'accounting', 'billing', a from unnest(array['view','create','edit']) a
union all
select 'readonly', m, 'view'
from unnest(array[
  'dashboard','customers','demands','properties','matching','portals','leak',
  'appointments','calls','commissions','reports','valuation'
]) m
on conflict (role, module, action) do nothing;
