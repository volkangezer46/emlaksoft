-- 20261008001000 geri alma: yedek fiyat tablosunu 20260825000300 degerlerine dondurur; kontor ayarlarini yalniz YENI seed
-- degerine esitse eski seed'e geri alir (admin degistirdiyse dokunmaz). billing.plan_definitions hic degismedi.
set local lock_timeout = '5s';

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
      when 'office' then 2490
      when 'professional' then 4990
      when 'business' then 8990
      when 'enterprise' then 12900
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
    when 'office' then 2490
    when 'professional' then 4990
    when 'business' then 8990
    when 'enterprise' then 12900
  end;
end;
$$;

revoke all privileges on function public.plan_monthly_amount(text) from public, anon, authenticated;
grant execute on function public.plan_monthly_amount(text) to service_role;

comment on function public.plan_monthly_amount(text) is
  'Aylik liste fiyati (KDV haric). TS resolveCatalogSettings ile ayni kural; ayar yoksa onayli katalog 749/2490/4990/8990.';

do $$
declare
  v text;
  j jsonb;
begin
  select s.value into v from public.platform_settings s where s.key = 'ef.tariff';
  if v is not null and nullif(btrim(v), '') is not null then
    begin j := v::jsonb; exception when others then j := null; end;
    if j = '{"valuationArsa":850,"valuationKonut":700,"valuationTicari":1050}'::jsonb then
      update public.platform_settings set value = '{"valuationArsa":5,"valuationKonut":5,"pdfFirst":2,"reportDetail":0}', updated_at = now() where key = 'ef.tariff';
    end if;
  end if;

  select s.value into v from public.platform_settings s where s.key = 'ef.packs';
  if v is not null and nullif(btrim(v), '') is not null then
    begin j := v::jsonb; exception when others then j := null; end;
    if j = $json$[{"id":"ef-1000-1a","name":"1 aylık · aylık 1.000 kontör","units":1000,"months":1,"priceNetTry":1000,"active":true,"order":10},
{"id":"ef-1000-3a","name":"3 aylık · aylık 1.000 kontör","units":3000,"months":3,"priceNetTry":2850,"active":true,"order":20},
{"id":"ef-1000-6a","name":"6 aylık · aylık 1.000 kontör","units":6000,"months":6,"priceNetTry":5400,"active":true,"order":30},
{"id":"ef-1000-12a","name":"12 aylık · aylık 1.000 kontör","units":12000,"months":12,"priceNetTry":10200,"active":true,"order":40},
{"id":"ef-2500-1a","name":"1 aylık · aylık 2.500 kontör","units":2500,"months":1,"priceNetTry":2500,"active":true,"order":50},
{"id":"ef-2500-3a","name":"3 aylık · aylık 2.500 kontör","units":7500,"months":3,"priceNetTry":7125,"active":true,"order":60},
{"id":"ef-2500-6a","name":"6 aylık · aylık 2.500 kontör","units":15000,"months":6,"priceNetTry":13500,"active":true,"popular":true,"order":70},
{"id":"ef-2500-12a","name":"12 aylık · aylık 2.500 kontör","units":30000,"months":12,"priceNetTry":25500,"active":true,"order":80},
{"id":"ef-5000-1a","name":"1 aylık · aylık 5.000 kontör","units":5000,"months":1,"priceNetTry":5000,"active":true,"order":90},
{"id":"ef-5000-3a","name":"3 aylık · aylık 5.000 kontör","units":15000,"months":3,"priceNetTry":14250,"active":true,"order":100},
{"id":"ef-5000-6a","name":"6 aylık · aylık 5.000 kontör","units":30000,"months":6,"priceNetTry":27000,"active":true,"order":110},
{"id":"ef-5000-12a","name":"12 aylık · aylık 5.000 kontör","units":60000,"months":12,"priceNetTry":51000,"active":true,"order":120}]$json$::jsonb then
      update public.platform_settings
         set value = $json$[{"id":"ef-25","name":"25 Kontör","units":25,"priceNetTry":299,"active":true,"order":10},
{"id":"ef-100","name":"100 Kontör","units":100,"priceNetTry":990,"active":true,"popular":true,"order":20},
{"id":"ef-300","name":"300 Kontör","units":300,"priceNetTry":2490,"active":true,"order":30},
{"id":"ef-1000","name":"1000 Kontör","units":1000,"priceNetTry":6900,"active":true,"order":40}]$json$,
             updated_at = now()
       where key = 'ef.packs';
    end if;
  end if;

  update public.platform_settings set value = '10', updated_at = now()
   where key = 'ef.welcome_units' and btrim(value) = '100';
end
$$;

notify pgrst, 'reload schema';
