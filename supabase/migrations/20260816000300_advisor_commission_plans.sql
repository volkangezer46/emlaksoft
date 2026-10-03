-- Faz 2 / 03: advisor_commission_plans — danışman bazlı komisyon planı (kademe, cap, ofis/referans/franchise payı).
--
-- NEDEN: bugün advisor_share yalnız bir RPC/form parametresi (varsayılan 50); profil/tenant düzeyinde
-- plan, kademe ve cap yok (belge 1B). Plan, src/lib/commission.ts `advisorShare` girdisinin kaynağı olur.
-- TASARIM: geçerlilik tarihli satırlar (valid_from/valid_to); aynı danışman için aynı valid_from tekrar
--   edemez. Çakışan aralık engeli (exclusion constraint) btree_gist eklentisi gerektirir; eklenti
--   eklemek bu migration'ın kapsamı değil, çakışma uygulama katmanında (en yeni valid_from kazanır) çözülür.
--   tiers jsonb dizisi: [{"from": 0, "share": 50}, {"from": 1000000, "share": 60}] (from = kümülatif ciro eşiği).
-- GERİ ALMA: rollbacks/20260816000300_advisor_commission_plans.rollback.sql (yeni tablo, veri planlar).
-- RİSK: düşük (yeni tablo, hiçbir mevcut hesabı değiştirmez; kod açılana dek okunmaz).
-- RLS: SELECT kendi planı VEYA earnings_all; yazma yalnız owner/gm (belge 3d).

create table if not exists public.advisor_commission_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  -- Danışman payı yüzdesi (kademe yoksa geçerli).
  base_share numeric(5,2) not null default 50 check (base_share >= 0 and base_share <= 100),
  tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array'),
  cap_amount numeric(14,2) check (cap_amount is null or cap_amount >= 0),
  cap_period text not null default 'year' check (cap_period in ('month', 'quarter', 'year', 'lifetime')),
  office_share numeric(5,2) check (office_share is null or (office_share >= 0 and office_share <= 100)),
  referral_share numeric(5,2) not null default 0 check (referral_share >= 0 and referral_share <= 100),
  franchise_share numeric(5,2) not null default 0 check (franchise_share >= 0 and franchise_share <= 100),
  valid_from date not null default current_date,
  valid_to date,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advisor_commission_plans_profile_tenant_fkey
    foreign key (profile_id, tenant_id)
    references public.profiles (id, tenant_id) on delete cascade,
  constraint advisor_commission_plans_valid_range
    check (valid_to is null or valid_to >= valid_from),
  constraint advisor_commission_plans_shares_total
    check (coalesce(office_share, 0) + referral_share + franchise_share <= 100),
  constraint advisor_commission_plans_unique_start
    unique (tenant_id, profile_id, valid_from)
);

comment on table public.advisor_commission_plans is
  'Danışman bazlı komisyon planı: temel pay, kademe, cap, ofis/referans/franchise payı, geçerlilik tarihleri.';

create index if not exists idx_advisor_commission_plans_profile
  on public.advisor_commission_plans (tenant_id, profile_id, valid_from desc);

drop trigger if exists trg_advisor_commission_plans_touch on public.advisor_commission_plans;
create trigger trg_advisor_commission_plans_touch
before update on public.advisor_commission_plans
for each row execute function public.faz2_touch_updated_at();

alter table public.advisor_commission_plans enable row level security;

create policy advisor_commission_plans_select on public.advisor_commission_plans
for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or (select public.has_effective_permission('earnings_all', 'view'))
  )
);

create policy advisor_commission_plans_insert on public.advisor_commission_plans
for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy advisor_commission_plans_update on public.advisor_commission_plans
for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy advisor_commission_plans_delete on public.advisor_commission_plans
for delete to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

revoke all on table public.advisor_commission_plans from public, anon;
grant select, insert, update, delete on table public.advisor_commission_plans to authenticated;
grant all on table public.advisor_commission_plans to service_role;
