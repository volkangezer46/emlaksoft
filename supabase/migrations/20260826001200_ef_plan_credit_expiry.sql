-- MIGRATION 20260826001200_ef_plan_credit_expiry.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001200_ef_plan_credit_expiry.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001200_ef_plan_credit_expiry.rollback.sql.
--
-- EmlakFiyati PLAN KONTORU DEVIR TAVANI. Plan kontoru (source 'plan') en cok N aylik hak kadar birikir; fazlasi
-- aylik cron tarafindan `ef_credit_expire_plan` ile defterden dusulur. Satin alinan paket (purchase), hos geldin
-- (bonus), admin (manual) ve iade (refund) kontoru ASLA dusulmez (suresiz).
--
-- NE DEGISIR
--   1. account_credit_ledger_source_check: 'expire' kaynagi eklenir (000100 listesi + 'expire'); ef satir CHECK'i
--      (account_credit_ledger_ef_entry_check: grant expires_at null, spend negatif tamsayi) DEGISMEZ: dusum bir
--      `spend` satiridir (source 'expire', feature 'ef_expire_plan').
--   2. YENI RPC public.ef_credit_expire_plan(p_tenant uuid, p_keep integer, p_idem text) -> jsonb
--      {ok, already, expired, available}; service_role-only, SECURITY DEFINER, search_path=''.
--   3. Ayar seed'i (idempotent, mevcut deger DEGISMEZ): ef.welcome_units = 10 (bilincli seed) ve
--      ef.welcome_since = bu migration'in uygulandigi an (ISO). Hos geldin kontoru yalniz tenants.created_at >=
--      ef.welcome_since olan ofislere verilir: mevcut ofislere GERIYE DONUK dagitim YOK.
--
-- HESAP (plan kalani): plan grantlari en once tuketilir varsayimi (suresi dolacak kontor once harcanir, musteri lehine):
--   planKalan = min(max(available,0), max( SUM(plan grant) - SUM(usage spend) - SUM(expire spend), 0 ))
--   fazla = planKalan - p_keep ; fazla > 0 ise spend(-fazla, source 'expire') yazilir. available acik rezervleri
--   zaten dusuk sayar; NEGATIF BAKIYE olusmaz (planKalan <= available).
-- IDEMPOTENCY: defter anahtari 'ef:expire:<tenant>:<p_idem>'; ayni anahtar ikinci kez = {already:true}, yeni satir yok.
--   fazla = 0 ise satir yazilmaz (anahtar tuketilmez; ayni ay icinde yeniden hesaplanabilir).
--
-- BAGIMLILIK: 20260826000100 (ef_credit_balance/grant, 'ef' birimi) canli; yoksa HICBIR sey yazmadan durur.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.account_credit_ledger') is null
    or pg_catalog.to_regprocedure('public.ef_credit_balance(uuid)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_grant(uuid, integer, text, text, jsonb)') is null then
    raise exception '20260826001200: once 20260826000100_ef_credit_wallet.sql uygulanmali (ef_credit_balance/ef_credit_grant yok).';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.account_credit_ledger'::regclass
      and c.conname = 'account_credit_ledger_ef_entry_check'
  ) then
    raise exception '20260826001200: account_credit_ledger_ef_entry_check yok; 20260826000100 durumu beklenenden farkli.';
  end if;
  if pg_catalog.to_regclass('public.platform_settings') is null or pg_catalog.to_regclass('public.tenants') is null then
    raise exception '20260826001200: platform_settings/tenants yok.';
  end if;
end
$$;

-- 1. Kaynak CHECK'ine 'expire' (mevcut kaynaklar korunur)
alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_source_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_source_check
  check (source in ('referral', 'partner', 'campaign', 'manual', 'usage', 'plan', 'purchase', 'bonus', 'refund', 'expire'));

-- 2. ef_credit_expire_plan(p_tenant, p_keep, p_idem) -> jsonb {ok, already, expired, available}
create or replace function public.ef_credit_expire_plan(
  p_tenant uuid,
  p_keep integer,
  p_idem text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_existing_amount numeric;
  v_plan_granted numeric;
  v_usage numeric;
  v_expired numeric;
  v_available bigint;
  v_plan_left bigint;
  v_excess bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_keep is null or p_keep < 0 or p_keep > 1000000 then
    raise exception 'Invalid keep.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  v_key := 'ef:expire:' || p_tenant::text || ':' || p_idem;

  select l.amount into v_existing_amount
  from public.account_credit_ledger l
  where l.idempotency_key = v_key;

  if found then
    v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
    return jsonb_build_object('ok', true, 'already', true, 'expired', (-v_existing_amount)::bigint, 'available', v_available);
  end if;

  select
    coalesce(sum(case when l.entry_type = 'grant' and l.source = 'plan' then l.amount end), 0),
    coalesce(sum(case when l.entry_type = 'spend' and l.source = 'usage' then -l.amount end), 0),
    coalesce(sum(case when l.entry_type = 'spend' and l.source = 'expire' then -l.amount end), 0)
  into v_plan_granted, v_usage, v_expired
  from public.account_credit_ledger l
  where l.tenant_id = p_tenant and l.unit = 'ef';

  v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
  v_plan_left := least(
    greatest(v_available, 0),
    greatest(v_plan_granted - v_usage - v_expired, 0)
  )::bigint;
  v_excess := v_plan_left - p_keep;

  if v_excess <= 0 then
    return jsonb_build_object('ok', true, 'already', false, 'expired', 0, 'available', v_available);
  end if;

  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, feature, meta)
  values
    (p_tenant, 'ef', 'spend', -v_excess, 'expire', v_key, 'ef_expire_plan',
     jsonb_build_object('plan_left', v_plan_left, 'keep', p_keep));

  return jsonb_build_object('ok', true, 'already', false, 'expired', v_excess, 'available', v_available - v_excess);
end;
$$;

revoke all on function public.ef_credit_expire_plan(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.ef_credit_expire_plan(uuid, integer, text) to service_role;
comment on function public.ef_credit_expire_plan(uuid, integer, text) is
  'EF plan kontoru devir tavani: plan kalani p_keep ustundeyse fazlayi spend (source expire) ile dusurur; (tenant,p_idem) tekil; paket/bonus/admin kontoru dokunulmaz. Service-role-only.';

-- 3. Hos geldin ayarlari (idempotent; mevcut deger korunur). welcome_since = uygulama ani: geriye donuk dagitim yok.
insert into public.platform_settings (key, value) values ('ef.welcome_units', '10')
on conflict (key) do nothing;

insert into public.platform_settings (key, value)
values ('ef.welcome_since', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
