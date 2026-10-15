-- MIGRATION 20261018080001_targets_scope_calls.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261018080001_targets_scope_calls.rollback.sql
-- BAGIMLILIK: 20260816000800 (targets faaliyet hedefleri: target_appointments/listings/demands), 20260826002900 (teams),
--   20261018080000 (report_sample_included yardimcisi bu dosyada kullanilmaz; sira yalniz pencere icin).
--
-- OA4: hedef koyma tek tek yapiliyordu.
--   * targets.team_id / targets.branch_id: takim ve sube hedefi. profile_id, team_id, branch_id'den EN COK BIRI dolu
--     (CHECK). Ucu de bossa ofis geneli hedeftir (eski anlam korunur: profile_id null = ofis geneli, ancak artik okuyucular
--     team_id/branch_id null kosulunu da ekler).
--   * targets.target_calls: cagri hedefi (faaliyet hedefi; calls.handled_by + started_at).
--   * target_demands DUSER: 20260816000800 ile eklenmis, hicbir kod okumuyor/yazmiyordu (gelistirme fazi; olu kolon).
--   * Benzersizlik: ayni kapsam + donem + baslangic icin tek hedef (toplu atama ve "gecen donemden kopyala" idempotent upsert).
--     Mevcut veride cift kayit varsa indeks OLUSTURULMAZ (uyari verilir; kod 23505 yerine yinelenen satir kontrolu ile de calisir).
--   * target_progress_counts(p_tenant_id, p_items): hedef basina randevu / yeni portfoy / cagri gerceklesmesi; kapsam bir PROFIL
--     LISTESIDIR (takim/sube hedefi uyelerin toplami). SECURITY INVOKER (RLS gecerli; parametreler yalniz daraltir).
-- ETKI: davranis (kolon dusurme + kisit). Idempotent.
-- KOD SIRASI: KOD YAYININDAN ONCE uygulanir (yeni kod team_id/branch_id/target_calls okur ve yazar).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.targets') is null or pg_catalog.to_regclass('public.teams') is null
     or pg_catalog.to_regclass('public.branches') is null or pg_catalog.to_regclass('public.calls') is null then
    raise exception '20261018080001: targets / teams / branches / calls yok.';
  end if;
end $$;

alter table public.targets add column if not exists team_id uuid references public.teams(id) on delete cascade;
alter table public.targets add column if not exists branch_id uuid references public.branches(id) on delete cascade;
alter table public.targets add column if not exists target_calls integer not null default 0;

alter table public.targets drop constraint if exists targets_target_calls_check;
alter table public.targets add constraint targets_target_calls_check check (target_calls >= 0);

alter table public.targets drop constraint if exists targets_single_scope_check;
alter table public.targets add constraint targets_single_scope_check
  check (num_nonnulls(profile_id, team_id, branch_id) <= 1);

alter table public.targets drop column if exists target_demands;

create index if not exists idx_targets_team on public.targets (team_id) where team_id is not null;
create index if not exists idx_targets_branch on public.targets (branch_id) where branch_id is not null;

comment on column public.targets.team_id is 'OA4: takim hedefi (profile_id/branch_id bos). Gerceklesme = takim uyelerinin toplami.';
comment on column public.targets.branch_id is 'OA4: sube hedefi (profile_id/team_id bos). Gerceklesme = sube danismanlarinin toplami.';
comment on column public.targets.target_calls is 'OA4: cagri hedefi (calls.handled_by, started_at donem icinde).';

-- Benzersizlik: yalniz mevcut veride cift yoksa.
do $$
begin
  if exists (
    select 1 from public.targets
    group by tenant_id, coalesce(profile_id, team_id, branch_id),
             case when profile_id is not null then 'p' when team_id is not null then 't' when branch_id is not null then 'b' else 'o' end,
             period, period_start
    having count(*) > 1
  ) then
    raise notice '20261018080001: targets tablosunda ayni kapsam/donem icin cift kayit var; benzersiz indeksler OLUSTURULMADI.';
  else
    create unique index if not exists uq_targets_profile_period on public.targets (tenant_id, profile_id, period, period_start);
    create unique index if not exists uq_targets_team_period on public.targets (tenant_id, team_id, period, period_start) where team_id is not null;
    create unique index if not exists uq_targets_branch_period on public.targets (tenant_id, branch_id, period, period_start) where branch_id is not null;
    create unique index if not exists uq_targets_office_period on public.targets (tenant_id, period, period_start)
      where profile_id is null and team_id is null and branch_id is null;
  end if;
end $$;

-- Hedef basina faaliyet gerceklesmesi (profil listesi kapsamli). p_items:
--   [{ id, start_at, end_at, profile_ids: uuid[] | null (null = ofis geneli), want_appointments, want_listings, want_calls }]
create or replace function public.target_progress_counts(p_tenant_id uuid, p_items jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when auth.uid() is null or p_tenant_id is null
              or p_tenant_id is distinct from public.current_active_tenant_id() then null else (
    select coalesce(jsonb_object_agg(i.id, jsonb_build_object(
      'appointments', case when coalesce(i.want_appointments, false) then (
        select count(*) from public.appointments a
        where a.tenant_id = p_tenant_id
          and a.status <> 'cancelled'
          and a.scheduled_at >= i.start_at and a.scheduled_at < i.end_at
          and (i.profile_ids is null or a.assigned_to = any (i.profile_ids))
      ) end,
      'listings', case when coalesce(i.want_listings, false) then (
        select count(*) from public.properties p
        where p.tenant_id = p_tenant_id
          and p.deleted_at is null
          and p.is_sample = false
          and p.created_at >= i.start_at and p.created_at < i.end_at
          and (i.profile_ids is null or p.assigned_to = any (i.profile_ids))
      ) end,
      'calls', case when coalesce(i.want_calls, false) then (
        select count(*) from public.calls c
        where c.tenant_id = p_tenant_id
          and c.is_sample = false
          and c.started_at >= i.start_at and c.started_at < i.end_at
          and (i.profile_ids is null or c.handled_by = any (i.profile_ids))
      ) end
    )), '{}'::jsonb)
    from (
      select r.*
      from jsonb_to_recordset(case when pg_catalog.jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
        as r(id text, start_at timestamptz, end_at timestamptz, profile_ids uuid[], want_appointments boolean,
             want_listings boolean, want_calls boolean)
      where r.id is not null and r.start_at is not null and r.end_at is not null
      limit 200
    ) i
  ) end;
$$;

revoke all on function public.target_progress_counts(uuid, jsonb) from public, anon;
grant execute on function public.target_progress_counts(uuid, jsonb) to authenticated;

comment on function public.target_progress_counts(uuid, jsonb) is
  'OA4: hedef basina randevu / yeni portfoy / cagri gerceklesmesi; kapsam profil listesi (takim/sube toplami). SECURITY INVOKER.';
