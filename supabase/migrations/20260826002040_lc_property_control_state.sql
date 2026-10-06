-- MIGRATION 20260826002040_lc_property_control_state.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002040_lc_property_control_state.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002040_lc_property_control_state.rollback.sql
-- BAGIMLILIK: 20260826002010 (lc_row_visible).
--
-- property_control_state (1:1, ozet/istatistik tablosu): properties.status serbest metindir ve ISTENEN yasam dongusu
-- asamalari oraya konamaz (ilan havuzu da ayni karari verdi: "properties.status'a DOKUNULMAZ"). Bu tablo TURETILMIS
-- asamayi, skorlari ve KPI bayraklarini tasir; yazan: src/lib/listing-control/server (service_role istemcisi ENJEKTE edilir).
-- KPI SAYISI = LISTE SATIRI esitligi (sifir cikmaz metrik): k_* bayraklari TEK pure fonksiyondan
-- (src/lib/listing-control/kpi.ts deriveKpiFlags) yazilir; sayim count(*) filter (where k_x), liste `where k_x` AYNI kolon.
-- Yuz binlerce portfoy icin: bayrak basina kismi indeks, keyset liste (risk_score desc, property_id), fillfactor 80.
-- is_sample = true satirlar KPI'dan haric (varsayilan).

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'lc_row_visible') then
    raise exception 'lc_row_visible yok; once 20260826002010 uygulanmali.';
  end if;
end $$;

create table if not exists public.property_control_state (
  property_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid,
  team_id uuid,
  advisor_id uuid,
  is_sample boolean not null default false,
  lifecycle_stage text not null default 'new' check (lifecycle_stage in
    ('new', 'pool', 'assigned', 'preparing', 'ready', 'published', 'marketing', 'offer', 'negotiation', 'deposit',
     'sold', 'rented', 'exited')),
  stage_since timestamptz not null default now(),
  exit_kind text check (exit_kind is null or exit_kind in
    ('sold', 'rented', 'cancelled', 'authority_expired', 'owner_withdrew', 'other_agency', 'portal_removed', 'passive', 'duplicate')),
  health_score smallint check (health_score is null or health_score between 0 and 100),
  health_color text check (health_color is null or health_color in ('green', 'yellow', 'orange', 'red', 'gray')),
  health_partial boolean not null default false,
  risk_score smallint not null default 0 check (risk_score between 0 and 100),
  portals_live smallint not null default 0,
  open_anomalies smallint not null default 0,
  assigned_at timestamptz,
  last_verified_at timestamptz,
  -- KPI bayraklari (deriveKpiFlags). Sayi ve liste ayni kolon.
  k_active boolean not null default false,
  k_in_portals boolean not null default false,
  k_awaiting_publish boolean not null default false,
  k_portal_missing boolean not null default false,
  k_price_mismatch boolean not null default false,
  k_in_review boolean not null default false,
  k_unverifiable boolean not null default false,
  k_healthy boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint property_control_state_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties (id, tenant_id) on delete cascade
) with (fillfactor = 80);

create index if not exists idx_pcs_tenant_risk on public.property_control_state (tenant_id, risk_score desc, property_id desc);
create index if not exists idx_pcs_active on public.property_control_state (tenant_id, advisor_id) where k_active;
create index if not exists idx_pcs_in_portals on public.property_control_state (tenant_id, advisor_id) where k_in_portals;
create index if not exists idx_pcs_awaiting on public.property_control_state (tenant_id, advisor_id) where k_awaiting_publish;
create index if not exists idx_pcs_missing on public.property_control_state (tenant_id, advisor_id) where k_portal_missing;
create index if not exists idx_pcs_price on public.property_control_state (tenant_id, advisor_id) where k_price_mismatch;
create index if not exists idx_pcs_review on public.property_control_state (tenant_id, advisor_id) where k_in_review;
create index if not exists idx_pcs_unverifiable on public.property_control_state (tenant_id, advisor_id) where k_unverifiable;
create index if not exists idx_pcs_branch on public.property_control_state (tenant_id, branch_id) where k_active;

alter table public.property_control_state enable row level security;

create policy property_control_state_select on public.property_control_state for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.lc_row_visible(branch_id, team_id, advisor_id))
);

-- Kullanici eylemleri (elle dogrulama, aciklama, kapatma) motor sonucunu eskitir. Kullanici service_role'e sahip olmadigindan
-- kayit "bayat" isaretlenir (updated_at geriye alinir); degerlendirme taramasi (lc_sweep_candidates) bir sonraki turda
-- en oncelikli olarak yeniden hesaplar. Yalnizca ICERIDEN (definer fonksiyonlar) cagrilir; hicbir role EXECUTE verilmez.
create or replace function public.lc_mark_state_stale(p_tenant_id uuid, p_property_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.property_control_state
     set updated_at = now() - interval '30 days'
   where tenant_id = p_tenant_id and property_id = p_property_id;
$$;
revoke all on function public.lc_mark_state_stale(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on table public.property_control_state from public, anon, authenticated;
grant select on table public.property_control_state to authenticated;
grant all on table public.property_control_state to service_role;

notify pgrst, 'reload schema';
