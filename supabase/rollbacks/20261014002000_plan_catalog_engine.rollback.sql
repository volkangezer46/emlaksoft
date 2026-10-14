-- Rollback: 20261014002000_plan_catalog_engine
-- Plan katalog motorunu geri alir: 4 fonksiyondaki `not public.billing_plan_known(x)` ifadesi yeniden sabit listeye
-- ("x not in ('advisor', 'office', 'professional', 'business', 'enterprise')") cevrilir, plan_monthly_amount 20261008001000
-- govdesine doner, FK'ler kaldirilip eski CHECK'ler geri konur, billing_plans + yardimcilar silinir.
-- ON KOSUL: hicbir ofis/abonelik/kota satiri adminden eklenen (taban olmayan) bir paketi kullanmiyor olmali; kullaniliyorsa
-- once o ofisler taban pakete tasinir (admin abonelik islemleri). Aksi halde HICBIR sey yazilmadan durur.
-- 'billing.plan_definitions' belgesindeki eklenen paket kayitlari (custom: true) birakilir: kod ve SQL migration yokken onlari okumaz.

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.tenants where plan not in ('advisor', 'office', 'professional', 'business', 'enterprise'))
     or exists (select 1 from public.subscriptions where plan not in ('advisor', 'office', 'professional', 'business', 'enterprise'))
     or exists (select 1 from public.subscriptions where pending_plan is not null
                  and pending_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise')) then
    raise exception '20261014002000 rollback: eklenen paketi kullanan ofis/abonelik var; once taban pakete tasiyin.';
  end if;
end
$$;

-- Kullanilmayan eklenen paket kota satirlari (CHECK geri gelmeden once)
delete from public.plan_entitlements
 where plan not in ('advisor', 'office', 'professional', 'business', 'enterprise');

-- 4 fonksiyon: yalniz donusturulen ifade geri cevrilir
do $$
declare
  r record;
  v_def text;
  v_count integer;
  v_pattern constant text := 'not public\.billing_plan_known\((btrim\([a-z_]+\)|[a-z_][a-z0-9_]*)\)';
begin
  for r in
    select t.sig, t.expected
    from (values
      ('public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)', 2),
      ('public.provision_registration(uuid,text,text,text,text,text,text,text,text,text,text,text)', 1),
      ('public.subscription_schedule_downgrade(text)', 1),
      ('public.update_tenant_plan_subscription(uuid,uuid,text,text)', 1)
    ) as t(sig, expected)
  loop
    v_def := pg_catalog.pg_get_functiondef(r.sig::regprocedure);
    select count(*) into v_count from pg_catalog.regexp_matches(v_def, v_pattern, 'g');
    if v_count = 0 then
      continue;
    end if;
    if v_count <> r.expected then
      raise exception '20261014002000 rollback: % govdesinde % donusum bekleniyordu, % bulundu.', r.sig, r.expected, v_count;
    end if;
    execute pg_catalog.regexp_replace(
      v_def, v_pattern, '\1 not in (''advisor'', ''office'', ''professional'', ''business'', ''enterprise'')', 'g');
  end loop;
end
$$;

-- plan_monthly_amount: 20261008001000 govdesi
create or replace function public.plan_monthly_amount(p_plan text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_doc jsonb;
  v_val jsonb;
  v_num numeric;
begin
  if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise') then
    return null;
  end if;

  v_doc := public.plan_catalog_document();

  if v_doc is null then
    return case v_plan
      when 'advisor' then 749
      when 'office' then 2790
      when 'professional' then 5490
      when 'business' then 8990
      when 'enterprise' then 14900
    end;
  end if;

  v_val := v_doc -> 'plans' -> v_plan -> 'monthlyTry';
  if jsonb_typeof(v_val) = 'number' then
    v_num := (v_val #>> '{}')::numeric;
    if v_num = trunc(v_num) and v_num between 1 and 1000000 then
      return v_num;
    end if;
  end if;

  return case v_plan
    when 'advisor' then 749
    when 'office' then 2790
    when 'professional' then 5490
    when 'business' then 8990
    when 'enterprise' then 14900
  end;
end;
$$;

revoke all privileges on function public.plan_monthly_amount(text) from public, anon, authenticated;
grant execute on function public.plan_monthly_amount(text) to service_role;

-- FK -> CHECK
alter table public.tenants drop constraint if exists tenants_plan_fkey;
alter table public.subscriptions drop constraint if exists subscriptions_plan_fkey;
alter table public.subscriptions drop constraint if exists subscriptions_pending_plan_fkey;
alter table public.plan_entitlements drop constraint if exists plan_entitlements_plan_fkey;

alter table public.tenants
  add constraint tenants_plan_check check (plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));
alter table public.subscriptions
  add constraint subscriptions_plan_check check (plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));
alter table public.subscriptions
  add constraint subscriptions_pending_plan_check
  check (pending_plan is null or pending_plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));
alter table public.plan_entitlements
  add constraint plan_entitlements_plan_check check (plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));

drop function if exists public.plan_catalog_engine_ready();
drop function if exists public.billing_plan_known(text);
drop table if exists public.billing_plans;
