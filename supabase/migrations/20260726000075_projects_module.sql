-- İnşaat Proje Satış v1 — projects + project_units
--
-- Neden:
--  * Ofisler müteahhit projelerinin (site/blok) daire stoklarını Excel'de
--    tutuyordu; rezervasyon/kapora/satış durumu sistemde izlenemiyordu.
--  * /app/projeler stok ızgarası bu iki tabloyu okur; durum geçişleri
--    audit_logs'a yazılır (uygulama tarafı, logActivity).
--
-- Tasarım kararları:
--  * project_units.status kapalı liste: available → reserved → deposit → sold;
--    "release" her durumdan available'a döner (uygulama denetler, DB sadece
--    değer kümesini korur).
--  * unique nulls not distinct (project_id, block, unit_no): blok girilmeyen
--    projelerde de aynı daire no iki kez açılamasın diye NULL bloklar da
--    çakışma sayılır (PG15+).
--  * customer_id on delete set null — müşteri silinirse daire kaydı yaşar,
--    yalnızca bağ düşer.

-- ============================================================
-- projects — proje (site / blok grubu) üst kaydı
-- ============================================================
create table if not exists public.projects (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  name           text        not null,
  developer_name text,
  location       text,
  district_id    uuid        references public.geo_districts(id),
  delivery_date  date,
  description    text,
  status         text        not null default 'selling'
                             check (status in ('planning', 'selling', 'delivered')),
  created_by     uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table  public.projects        is 'İnşaat / müteahhit projeleri — daire stoğu project_units''ta';
comment on column public.projects.status is 'planning: planlama | selling: satışta | delivered: teslim edildi';

create index if not exists idx_projects_tenant
  on public.projects (tenant_id, created_at desc);

-- ============================================================
-- project_units — daire stoğu
-- ============================================================
create table if not exists public.project_units (
  id             uuid          primary key default gen_random_uuid(),
  tenant_id      uuid          not null references public.tenants(id)   on delete cascade,
  project_id     uuid          not null references public.projects(id)  on delete cascade,
  block          text,
  floor          int,
  unit_no        text          not null,
  rooms          text,
  gross_m2       numeric(8,1),
  list_price     numeric(14,2),
  status         text          not null default 'available'
                               check (status in ('available', 'reserved', 'deposit', 'sold')),
  customer_id    uuid          references public.customers(id) on delete set null,
  reserved_until timestamptz,
  sold_at        timestamptz,
  notes          text,
  unique nulls not distinct (project_id, block, unit_no)
);

comment on table  public.project_units                is 'Proje daire stoğu — durum: available|reserved|deposit|sold';
comment on column public.project_units.reserved_until is 'Rezervasyon opsiyon bitişi — geçmişse UI amber uyarı gösterir';

create index if not exists idx_project_units_project
  on public.project_units (project_id, block, floor, unit_no);

create index if not exists idx_project_units_tenant_status
  on public.project_units (tenant_id, status);

create index if not exists idx_project_units_customer
  on public.project_units (customer_id);

-- ============================================================
-- RLS — diğer tenant tabloları ile aynı desen (bkz. deal_costs)
-- ============================================================
alter table public.projects      enable row level security;
alter table public.project_units enable row level security;

drop policy if exists projects_tenant             on public.projects;
drop policy if exists projects_tenant_insert      on public.projects;
drop policy if exists project_units_tenant        on public.project_units;
drop policy if exists project_units_tenant_insert on public.project_units;

create policy projects_tenant on public.projects
  using (tenant_id = public.current_tenant_id());

create policy projects_tenant_insert on public.projects for insert
  with check (tenant_id = public.current_tenant_id());

create policy project_units_tenant on public.project_units
  using (tenant_id = public.current_tenant_id());

create policy project_units_tenant_insert on public.project_units for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.projects      to authenticated, service_role;
grant all on public.project_units to authenticated, service_role;

-- ============================================================
-- permission_defaults — 'projects' modülü seed'i
-- (İstenen: owner/gm/branch_manager ALL; advisor view-create-edit.
--  NOT: src/lib/permissions.ts'teki fallback MATRIX branch_manager için
--  delete'siz, advisor için yalnızca view tanımlar — çalışma zamanında
--  DB'deki bu satırlar geçerlidir, matris yalnızca acil-durum fallback'idir.)
-- ============================================================
insert into public.permission_defaults (role, module, action)
select r, 'projects', a
from (values ('owner'), ('gm'), ('branch_manager')) as roles(r)
cross join (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select 'advisor', 'projects', a
from (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;
