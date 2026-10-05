-- MIGRATION 20260826001900_growth_dashboard_b12_reapply.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001900_growth_dashboard_b12_reapply.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001900_growth_dashboard_b12_reapply.rollback.sql
-- BAGIMLILIK: 20260826000600 -> 000900 (B12) -> 001000 (rol kapisi). On-kosul blogu eksik/sapmada HICBIR sey yazmaz.
--
-- SORUN: 20260826001000, growth_my_dashboard'u 000600'un ESKI govdesinden yeniden yazdi ve 000900'in B12 duzeltmesini ezdi
-- (canlida dogrulandi): 'money_visible' alani panodan kayboldu, davet satiri tutarlari tam TL'ye yuvarlanmadan donuyor.
--
-- TEMEL ALINAN GOVDE: growth_my_dashboard icin 000900'in B12 govdesi (money_visible, kazanilan/bekleyen TL, tam TL'ye yuvarli
-- davet tutari) + 001000'in rol kapisi. growth_my_partner_dashboard 001000 govdesiyle AYNEN kalir (yeniden yazilmaz; yalniz md5 korumasi).
--
-- SECILEN DAVRANIS (iki govdenin KESISIMI = en kisitlayici guvenli): rol owner/gm degilse (current_profile_role(), 001000 kontrati)
-- RPC NULL doner (000900 gibi 0/gizli degil, cunku 001000 daha kisitlayici: sayac/kod/davet verisi de sizmaz). owner/gm icin
-- B12 govdesi: money_visible=true, TL tutarlari gercek, davet tutari tam TL'ye yuvarli. Uygulama guvenli: src/app/app/buyume/page.tsx
-- owner/gm disini zaten yonlendirir; parseDashboard (src/lib/growth/program.ts) NULL/obje-disi girdide null doner (sayfa etkin degil
-- kipine duser), money_visible yoksa true sayar. Rol kaynagi: 001000'deki public.current_profile_role() (000900'in profiles aramasi yerine).
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan sonra):
-- select pg_get_functiondef('public.growth_my_dashboard()'::regprocedure) like '%money_visible%' as b12,
--        pg_get_functiondef('public.growth_my_dashboard()'::regprocedure) like '%current_profile_role()%' as rol,
--        has_function_privilege('authenticated','public.growth_my_dashboard()','execute') as auth_dash;
-- BEKLENEN: t | t | t

set local lock_timeout = '5s';

do $$
declare
  r record;
  v_n int;
  v_md5 text;
begin
  if pg_catalog.to_regprocedure('public.growth_my_dashboard()') is null
     or pg_catalog.to_regprocedure('public.growth_my_partner_dashboard()') is null then
    raise exception 'Once 20260826000600/000900/001000 uygulanmali (growth_my_dashboard / growth_my_partner_dashboard yok).';
  end if;
  if pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_profile_role()/current_tenant_id() yok.';
  end if;
  for r in
    select * from (values
      ('growth_my_dashboard',         '5c6bc2e9f98e43d1963841213a8377fb', '9323567490cb614df3843ae8de05ac16'),
      ('growth_my_partner_dashboard', 'dbaf7fed40153b2fb12a65af1560ffd7', 'dbaf7fed40153b2fb12a65af1560ffd7')
    ) as t(fn, m_base, m_new)
  loop
    select count(*), max(md5(replace(p.prosrc, E'\r', ''))) into v_n, v_md5
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = r.fn;
    if v_n <> 1 then
      raise exception 'growth fonksiyonu % bulunamadi ya da birden fazla surum var (%)', r.fn, v_n;
    end if;
    if v_md5 <> r.m_base and v_md5 <> r.m_new then
      raise exception 'Canli % govdesi 001000 surumunden saparak degismis (md5 %); HICBIR sey yazilmadi.', r.fn, v_md5;
    end if;
  end loop;
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
  -- B12: TL tutarlari yalniz ofis sahibi / genel mudur gorur.
  v_money boolean := coalesce(public.current_profile_role(), '') in ('owner', 'gm');
begin
  if v_tenant is null then
    return null;
  end if;
  -- R1: ofis buyume/odul verisi yalniz owner/gm (danisman/mudur gormez). Rol yoksa/baskaysa NULL (sayfa bos durum gosterir).
  if not v_money then
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

  -- Davet satiri tutari = davetcinin kazandigi odul (davet edilenin paket fiyatiyla orantili): tam TL'ye yuvarli.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into v_invites
  from (
    select sa.created_at as at,
           case
             when c.status = 'paid' then 'paid'
             when c.status in ('held', 'approved', 'pending') then 'waiting'
             when c.status in ('reversed', 'rejected') then 'cancelled'
             else 'trial' end as stage,
           case when v_money then round(coalesce(c.amount_try, 0), 0) else 0 end as amount
    from public.signup_attributions sa
    left join public.growth_reward_claims c on c.referred_tenant_id = sa.tenant_id and c.component = 'base'
    where sa.referrer_tenant_id = v_tenant and sa.ref_kind = 'referral'
    order by sa.created_at desc limit 200
  ) x;

  if v_money then
    select coalesce(sum(amount_try), 0) into v_earned from public.growth_reward_claims
    where beneficiary_tenant_id = v_tenant and status = 'paid';
    select coalesce(sum(amount_try), 0) into v_pending from public.growth_reward_claims
    where beneficiary_tenant_id = v_tenant and status in ('held', 'approved', 'pending');
  else
    v_earned := 0;
    v_pending := 0;
  end if;
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
    'money_visible', v_money,
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
