-- Faz 2 / 09: assignment_rules (+ assignment_rule_members) — otomatik atama kuralları.
--
-- NEDEN: lead-intake.ts::pickAssignee bugün yalnız "en az yüklü aktif danışman" seçiyor; kural ayarı,
-- ağırlık, uygunluk, SLA ve yedek zinciri yok (belge 1B). Belge "yeni tablo veya tenant jsonb" diyor;
-- ağırlık/yedek zinciri için FK'li üye satırları (profile silinirse/pasifse temiz) jsonb'den güvenli
-- olduğundan iki küçük tablo seçildi (tenant jsonb sütunu eklenmez, mükerrerlik yok).
-- TASARIM:
--   assignment_rules: ad, öncelik, hangi kaynak (source null = hepsi), strateji
--     (least_loaded | round_robin | weighted), uygunluk (izinli/pasif danışmanı atla), SLA dakikası,
--     SLA aşımında yedek zincire geçiş, is_active.
--   assignment_rule_members: kural-profil, weight (weighted için), is_available (elle kapatma),
--     fallback_order (null = ana havuz, 1..n = yedek zincir sırası), max_open (kapasite, null = sınırsız).
-- GERİ ALMA: rollbacks/20260816000900_assignment_rules.rollback.sql (iki tablo düşer; kod yoksa etkisiz,
--   pickAssignee varsayılan davranışına döner).
-- RİSK: düşük (yeni tablolar; kod bağlanana dek okunmaz). Atama motorunun server/admin yolundan okunması
--   gerekiyorsa yeni service_role kullanımı eklemek yerine RLS'li RPC tercih edilir (admin-client allowlist).
-- RLS: SELECT settings:view; yazma yalnız owner/gm.

create table if not exists public.assignment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  priority integer not null default 100 check (priority between 0 and 10000),
  source text check (source is null or char_length(source) <= 64),
  strategy text not null default 'least_loaded'
    check (strategy in ('least_loaded', 'round_robin', 'weighted')),
  skip_on_leave boolean not null default true,
  sla_minutes integer check (sla_minutes is null or sla_minutes between 1 and 10080),
  escalate_on_sla_breach boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_assignment_rules_id_tenant
  on public.assignment_rules (id, tenant_id);
create index if not exists idx_assignment_rules_active
  on public.assignment_rules (tenant_id, is_active, priority);

create table if not exists public.assignment_rule_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid not null,
  profile_id uuid not null,
  weight integer not null default 1 check (weight between 0 and 1000),
  is_available boolean not null default true,
  fallback_order integer check (fallback_order is null or fallback_order >= 1),
  max_open integer check (max_open is null or max_open >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_rule_members_rule_tenant_fkey
    foreign key (rule_id, tenant_id)
    references public.assignment_rules (id, tenant_id) on delete cascade,
  constraint assignment_rule_members_profile_tenant_fkey
    foreign key (profile_id, tenant_id)
    references public.profiles (id, tenant_id) on delete cascade,
  constraint assignment_rule_members_unique_member unique (rule_id, profile_id)
);

-- Aynı kuralda yedek zinciri sırası tekrar etmez.
create unique index if not exists uq_assignment_rule_members_fallback
  on public.assignment_rule_members (rule_id, fallback_order)
  where fallback_order is not null;
create index if not exists idx_assignment_rule_members_profile
  on public.assignment_rule_members (tenant_id, profile_id);

drop trigger if exists trg_assignment_rules_touch on public.assignment_rules;
create trigger trg_assignment_rules_touch
before update on public.assignment_rules
for each row execute function public.faz2_touch_updated_at();

drop trigger if exists trg_assignment_rule_members_touch on public.assignment_rule_members;
create trigger trg_assignment_rule_members_touch
before update on public.assignment_rule_members
for each row execute function public.faz2_touch_updated_at();

alter table public.assignment_rules enable row level security;
alter table public.assignment_rule_members enable row level security;

create policy assignment_rules_select on public.assignment_rules
for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('settings', 'view'))
);

create policy assignment_rules_insert on public.assignment_rules
for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy assignment_rules_update on public.assignment_rules
for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy assignment_rules_delete on public.assignment_rules
for delete to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy assignment_rule_members_select on public.assignment_rule_members
for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('settings', 'view'))
);

create policy assignment_rule_members_insert on public.assignment_rule_members
for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy assignment_rule_members_update on public.assignment_rule_members
for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy assignment_rule_members_delete on public.assignment_rule_members
for delete to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

revoke all on table public.assignment_rules from public, anon;
revoke all on table public.assignment_rule_members from public, anon;
grant select, insert, update, delete on table public.assignment_rules to authenticated;
grant select, insert, update, delete on table public.assignment_rule_members to authenticated;
grant all on table public.assignment_rules to service_role;
grant all on table public.assignment_rule_members to service_role;
