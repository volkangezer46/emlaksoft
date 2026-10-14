-- MIGRATION 20261015011000_lc_finance_rls_initplan.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi:
--   scripts/db-shadow-replay.sh + supabase/tests/kq2_lc_finance_rls.test.sql).
-- Geri alma: supabase/rollbacks/20261015011000_lc_finance_rls_initplan.rollback.sql (eski ifadeler birebir, gölgeden deparse;
--   yeni yardimcilar dusurulur).
-- BAGIMLILIK: 20260826002010_lc_scope_helpers.sql (lc_current_branch_id / lc_current_team_id / lc_row_visible),
--   20261007000200_lc_lifecycle_events.sql, 20261011001300_earnings_statement_privacy.sql (finance_statement_* politikalari).
--
-- AMAC (KQ2, RLS maliyeti): ilan kontrol tablolarinda `(select lc_row_visible(branch_id, team_id, advisor_id))` ve
--   ekstre tablolarinda `(select finance_account_access(account_id, 'view'))` satir kolonu aldigi icin satir basina
--   korelasyonlu SubPlan'dir (her satirda DEFINER fonksiyonu + current_profile_role + profiles okumasi).
-- YENI IFADE (anlam ayni): rol, sube ve ekip degerleri satirdan BAGIMSIZ yardimcilardan InitPlan olarak BIR kez alinir,
--   satir kolonlariyla duz karsilastirilir:
--     lc_scope_sees_all()    : oturum var ve rol owner/gm                      -> tum satirlar
--     lc_scope_branch_id()   : rol branch_manager ise profilin subesi, degilse NULL -> branch_id = <sube>
--     lc_scope_team_id()     : rol team_lead ise profilin takimi, degilse NULL     -> team_id = <takim>
--     lc_scope_advisor_id()  : rol owner/gm/branch_manager DEGILSE auth.uid(), degilse NULL -> advisor_id = <ben>
--   NULL donen yardimci `kolon = NULL` ile hicbir satiri eslemez; lc_row_visible'in CASE dallarinin birebir karsiligi:
--   oturumsuz -> hicbiri; owner/gm -> hepsi; branch_manager -> yalniz sube (kendi ilani dahil degil, eskisi gibi);
--   team_lead -> takim VEYA kendi; digerleri -> kendi.
--   Ekstre tablolari: account_id, kullanicinin gorebildigi hesaplarin korelasyonsuz alt sorgusunda aranir
--   (finance_account_access(...,'view') ile ayni kural: hesap aktif kiracida ve [kisisel + sahibi ben] ya da [ofis + expenses:view]).
--   Alt sorgu finance_accounts RLS'ine tabidir; finance_accounts_select ayni kosulu tasidigi icin kume daralmaz.
-- lc_row_visible ve finance_account_access tekil kontrol (RPC) icin aynen KORUNUR.
-- ALTER POLICY: ad, komut, rol (TO authenticated) ve permissive degismez. Idempotent.
set local lock_timeout = '5s';

-- ---------- Satirdan bagimsiz kapsam yardimcilari (InitPlan olarak cagrilir) ----------
create or replace function public.lc_scope_sees_all()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null and coalesce(public.current_profile_role(), '') in ('owner', 'gm');
$$;

create or replace function public.lc_scope_branch_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when auth.uid() is not null and coalesce(public.current_profile_role(), '') = 'branch_manager'
      then public.lc_current_branch_id()
  end;
$$;

create or replace function public.lc_scope_team_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when auth.uid() is not null and coalesce(public.current_profile_role(), '') = 'team_lead'
      then public.lc_current_team_id()
  end;
$$;

create or replace function public.lc_scope_advisor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(public.current_profile_role(), '') in ('owner', 'gm', 'branch_manager') then null
    else auth.uid()
  end;
$$;

revoke all on function public.lc_scope_sees_all() from public, anon;
revoke all on function public.lc_scope_branch_id() from public, anon;
revoke all on function public.lc_scope_team_id() from public, anon;
revoke all on function public.lc_scope_advisor_id() from public, anon;
grant execute on function public.lc_scope_sees_all() to authenticated, service_role;
grant execute on function public.lc_scope_branch_id() to authenticated, service_role;
grant execute on function public.lc_scope_team_id() to authenticated, service_role;
grant execute on function public.lc_scope_advisor_id() to authenticated, service_role;

comment on function public.lc_scope_sees_all() is 'KQ2: ilan kontrol RLS kapsami (InitPlan) — owner/gm tum satirlar. Tekil kontrol: lc_row_visible.';
comment on function public.lc_scope_branch_id() is 'KQ2: ilan kontrol RLS kapsami (InitPlan) — branch_manager ise profil subesi, degilse NULL.';
comment on function public.lc_scope_team_id() is 'KQ2: ilan kontrol RLS kapsami (InitPlan) — team_lead ise profil takimi, degilse NULL.';
comment on function public.lc_scope_advisor_id() is 'KQ2: ilan kontrol RLS kapsami (InitPlan) — owner/gm/branch_manager disinda auth.uid(), degilse NULL.';

-- ---------- Ilan kontrol tablolari (6 politika, ayni kalip) ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'listing_anomalies', 'listing_control_events', 'listing_verifications',
    'portal_listing_health', 'property_control_state', 'lc_lifecycle_events'
  ] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise notice 'KQ2: % yok, atlandi', t;
      continue;
    end if;
    execute format($p$
      alter policy %I on public.%I
        using (
          (tenant_id = (select public.current_tenant_id()))
          and (select public.has_effective_permission('portals', 'view'))
          and (
            (select public.lc_scope_sees_all())
            or branch_id = (select public.lc_scope_branch_id())
            or team_id = (select public.lc_scope_team_id())
            or advisor_id = (select public.lc_scope_advisor_id())
          )
        )
    $p$, t || '_select', t);
  end loop;
end $$;

-- ---------- Banka ekstresi ice aktarma tablolari ----------
alter policy finance_statement_imports_select on public.finance_statement_imports
  using (
    (tenant_id = (select public.current_active_tenant_id()))
    and account_id in (
      select a.id
      from public.finance_accounts a
      where a.tenant_id = (select public.current_active_tenant_id())
        and (
          (a.owner_scope = 'user' and a.owner_user_id = (select auth.uid()))
          or (a.owner_scope = 'office' and (select public.has_effective_permission('expenses', 'view')))
        )
    )
  );

alter policy finance_statement_mappings_select on public.finance_statement_mappings
  using (
    (tenant_id = (select public.current_active_tenant_id()))
    and account_id in (
      select a.id
      from public.finance_accounts a
      where a.tenant_id = (select public.current_active_tenant_id())
        and (
          (a.owner_scope = 'user' and a.owner_user_id = (select auth.uid()))
          or (a.owner_scope = 'office' and (select public.has_effective_permission('expenses', 'view')))
        )
    )
  );
