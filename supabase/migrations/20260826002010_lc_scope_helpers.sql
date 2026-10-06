-- MIGRATION 20260826002010_lc_scope_helpers.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002010_lc_scope_helpers.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002010_lc_scope_helpers.rollback.sql
-- BAGIMLILIK: public.profiles (branch_id, role), public.current_tenant_id(), public.current_profile_role(),
--   public.oversight_settings (20260820000100; yoksa ayar kolonu atlanir, kod varsayilanla calisir).
--
-- AMAC: ilan kontrol tablolarinin rol kapsamli RLS'i icin tek merkez yardimcilar.
--   owner/gm: ofis geneli · branch_manager: kendi subesi · team_lead: kendi takimi · digerleri: yalniz kendi ilani.
-- NOT (takim modeli): depoda `teams` tablosu / profiles.team_id YOK (bu migration EKLEMEZ; ayri is, plan §I/4).
--   lc_current_team_id() profiles'ta team_id kolonu YOKKEN null doner (to_jsonb ile dinamik okur): takim lideri bu
--   durumda yalniz kendi ilanlarini gorur; kolon eklendiginde kod/politika degismeden takim kapsami calisir.
-- NOT (eski listeler): properties/portal_listings RLS'i satir kapsami UYGULAMIYOR ve bu migration DEGISTIRMEZ.
--   Kapsam yalniz yeni ilan kontrol tablolarina uygulanir (plan §I/7: ayri guvenlik isi, sahip karari).
-- Esikler/agirliklar/SLA: yeni ayar tablosu YOK, oversight_settings.listing_control jsonb (RLS owner/gm hazir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'profiles yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

create or replace function public.lc_current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.branch_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.lc_current_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(to_jsonb(p) ->> 'team_id', '')::uuid from public.profiles p where p.id = auth.uid();
$$;

-- Satir gorunurlugu. Satir basina (branch, team, advisor) denormalize kolonlari verilir; alt sorgu YOK.
create or replace function public.lc_row_visible(p_branch uuid, p_team uuid, p_advisor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when coalesce(public.current_profile_role(), '') in ('owner', 'gm') then true
    when coalesce(public.current_profile_role(), '') = 'branch_manager' then
      p_branch is not null and p_branch is not distinct from (select p.branch_id from public.profiles p where p.id = auth.uid())
    when coalesce(public.current_profile_role(), '') = 'team_lead' then
      (p_team is not null and p_team is not distinct from
        (select nullif(to_jsonb(p) ->> 'team_id', '')::uuid from public.profiles p where p.id = auth.uid()))
      or p_advisor = auth.uid()
    else p_advisor = auth.uid()
  end;
$$;

revoke all on function public.lc_current_branch_id() from public, anon;
revoke all on function public.lc_current_team_id() from public, anon;
revoke all on function public.lc_row_visible(uuid, uuid, uuid) from public, anon;
grant execute on function public.lc_current_branch_id() to authenticated, service_role;
grant execute on function public.lc_current_team_id() to authenticated, service_role;
grant execute on function public.lc_row_visible(uuid, uuid, uuid) to authenticated, service_role;

-- Ofis ayari: esikler, risk/saglik agirliklari, kontrol sikligi, SLA (src/lib/listing-control/config.ts normalize eder).
do $$
begin
  if pg_catalog.to_regclass('public.oversight_settings') is not null then
    alter table public.oversight_settings add column if not exists listing_control jsonb not null default '{}'::jsonb;
  end if;
end $$;

notify pgrst, 'reload schema';
