-- Rollback: 20260826001900_growth_dashboard_b12_reapply. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- growth_my_dashboard govdesini 20260826001000 surumune dondurur (B12 yeniden kaybolur; yalniz acil durumda).
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
