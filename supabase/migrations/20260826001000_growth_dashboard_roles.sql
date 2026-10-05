-- MIGRATION 20260826001000_growth_dashboard_roles.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001000_growth_dashboard_roles.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001000_growth_dashboard_roles.rollback.sql
-- BAGIMLILIK: 20260826000600 (growth_my_dashboard / growth_my_partner_dashboard). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (R1): iki ofis-okuma RPC'si bugun herhangi bir oturumlu kullaniciya kendi tenant'inin davet/odul/ortak verisini doner.
-- Bu veri (kazanc, davet edilen ofisler) yonetim bilgisidir: YALNIZ current_profile_role() in ('owner','gm') icin doner; digerlerine NULL.
-- MEVCUT DAVRANIS: owner/gm icin govdeler 20260826000600 ile AYNI (yalniz rol kapisi eklenir). Imza, security definer/search_path ayni;
-- CREATE OR REPLACE mevcut grant'leri korur.
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan sonra):
-- select pg_get_functiondef('public.growth_my_dashboard()'::regprocedure) like '%current_profile_role()%' as dash_rol,
--        pg_get_functiondef('public.growth_my_partner_dashboard()'::regprocedure) like '%current_profile_role()%' as partner_rol,
--        has_function_privilege('authenticated','public.growth_my_dashboard()','execute') as auth_dash;
-- BEKLENEN: t | t | t

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.growth_my_dashboard()') is null
     or pg_catalog.to_regprocedure('public.growth_my_partner_dashboard()') is null then
    raise exception 'Once 20260826000600_growth_referral_engine.sql uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_profile_role()/current_tenant_id() yok.';
  end if;
end $$;

create or replace function public.growth_my_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  s public.growth_referral_settings%rowtype;
  r public.growth_reward_rules%rowtype;
  v_code text;
  v_clicks bigint := 0;
  v_invites jsonb;
  v_earned numeric;
  v_pending numeric;
  v_paid_n int;
  v_signups int;
  v_waiting int;
  v_cancelled int;
  v_trial int;
  v_enabled boolean := public.growth_flag_on('growth_referral_enabled');
begin
  if v_tenant is null then
    return null;
  end if;
  -- R1: ofis buyume/odul verisi yalniz owner/gm (danisman/mudur gormez). Rol yoksa/baskaysa NULL (sayfa bos durum gosterir).
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    return null;
  end if;
  select * into s from public.growth_referral_settings where singleton;
  select * into r from public.growth_reward_rules
  where kind = 'referral' and is_active and valid_from <= now() and (valid_until is null or valid_until > now())
  order by created_at desc limit 1;
  select c.code into v_code from public.growth_referral_codes c where c.tenant_id = v_tenant and c.is_active;
  if v_code is not null then
    select coalesce(sum(n), 0) into v_clicks from public.growth_click_counters where kind = 'referral' and code = v_code;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into v_invites
  from (
    select sa.created_at as at,
           case
             when c.status = 'paid' then 'paid'
             when c.status in ('held', 'approved', 'pending') then 'waiting'
             when c.status in ('reversed', 'rejected') then 'cancelled'
             else 'trial' end as stage,
           coalesce(c.amount_try, 0) as amount
    from public.signup_attributions sa
    left join public.growth_reward_claims c on c.referred_tenant_id = sa.tenant_id and c.component = 'base'
    where sa.referrer_tenant_id = v_tenant and sa.ref_kind = 'referral'
    order by sa.created_at desc limit 200
  ) x;

  select coalesce(sum(amount_try), 0) into v_earned from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and status = 'paid';
  select coalesce(sum(amount_try), 0) into v_pending from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and status in ('held', 'approved', 'pending');
  select count(*) into v_paid_n from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status = 'paid';
  select count(*) into v_signups from public.signup_attributions where referrer_tenant_id = v_tenant and ref_kind = 'referral';
  select count(*) into v_waiting from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status in ('held', 'approved', 'pending');
  select count(*) into v_cancelled from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status in ('reversed', 'rejected');
  v_trial := greatest(v_signups - v_paid_n - v_waiting - v_cancelled, 0);

  return jsonb_build_object(
    'enabled', v_enabled,
    'code', v_code,
    'clicks', v_clicks,
    'signups', v_signups,
    'trial', v_trial,
    'waiting', v_waiting,
    'paid', v_paid_n,
    'cancelled', v_cancelled,
    'earned_try', v_earned,
    'pending_try', v_pending,
    'invites', v_invites,
    'rule', case when r.id is null then null else jsonb_build_object(
      'reward_type', r.reward_type, 'reward_value', r.reward_value, 'hold_days', r.hold_days,
      'credit_expires_days', r.credit_expires_days) end,
    'tiers', jsonb_build_object(
      'tier1_at', s.tier1_at, 'tier1_bonus_months', s.tier1_bonus_months, 'tier1_badge', s.tier1_badge,
      'tier2_at', s.tier2_at, 'tier2_bonus_months', s.tier2_bonus_months, 'tier2_badge', s.tier2_badge,
      'annual_cap_months', s.annual_cap_months),
    'welcome_credit_try', s.welcome_credit_try);
end;
$$;

create or replace function public.growth_my_partner_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  s public.growth_referral_settings%rowtype;
  p public.growth_partners%rowtype;
  v_clicks bigint := 0;
  v_signups int;
  v_payers int;
  v_pending numeric;
  v_approved numeric;
  v_paid numeric;
  v_clawback numeric;
  v_pct numeric;
  v_next_at int;
begin
  if v_tenant is null then
    return null;
  end if;
  -- R1: ofis buyume/odul verisi yalniz owner/gm (danisman/mudur gormez). Rol yoksa/baskaysa NULL (sayfa bos durum gosterir).
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    return null;
  end if;
  select * into p from public.growth_partners where owner_tenant_id = v_tenant and status in ('active', 'suspended') order by created_at limit 1;
  if not found then
    return null;
  end if;
  select * into s from public.growth_referral_settings where singleton;
  select coalesce(sum(n), 0) into v_clicks from public.growth_click_counters where kind = 'partner' and code = p.code;
  select count(*) into v_signups from public.signup_attributions where partner_id = p.id;
  select count(distinct sa.tenant_id) into v_payers
  from public.signup_attributions sa
  join public.subscriptions sub on sub.tenant_id = sa.tenant_id and sub.status = 'active'
  where sa.partner_id = p.id;
  select coalesce(sum(amount_try) filter (where status in ('held', 'pending')), 0),
         coalesce(sum(amount_try) filter (where status = 'approved' and payout_id is null), 0),
         coalesce(sum(amount_try) filter (where status = 'paid'), 0),
         coalesce(sum(amount_try) filter (where status = 'reversed' and 'clawback_due' = any (flags)), 0)
    into v_pending, v_approved, v_paid, v_clawback
  from public.growth_reward_claims where partner_id = p.id;
  v_pct := case when v_payers <= s.partner_tier1_max then s.partner_tier1_pct
                when v_payers <= s.partner_tier2_max then s.partner_tier2_pct else s.partner_tier3_pct end;
  v_next_at := case when v_payers <= s.partner_tier1_max then s.partner_tier1_max + 1
                    when v_payers <= s.partner_tier2_max then s.partner_tier2_max + 1 else null end;
  return jsonb_build_object(
    'name', p.name, 'code', p.code, 'status', p.status,
    'program_enabled', public.growth_flag_on('growth_partner_enabled'),
    'cash_enabled', public.growth_flag_on('growth_cash_payout_enabled'),
    'is_tax_payer', p.is_tax_payer,
    'clicks', v_clicks, 'signups', v_signups, 'payers', v_payers,
    'pending_try', v_pending, 'payable_try', v_approved, 'paid_try', v_paid, 'clawback_due_try', v_clawback,
    'tier_pct', v_pct, 'next_tier_at', v_next_at, 'min_payout_try', s.partner_min_payout_try,
    'duration_months', s.partner_duration_months);
end;
$$;

