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
    if j = '{"valuationArsa":850,"valuationKonut":700,"pdfFirst":0,"reportDetail":0,"valuationTicari":1050,"listingAnalysis":1}'::jsonb then
      update public.platform_settings set value = '{"valuationArsa":5,"valuationKonut":5,"pdfFirst":2,"reportDetail":0}', updated_at = now() where key = 'ef.tariff';
    end if;
  end if;

  select s.value into v from public.platform_settings s where s.key = 'ef.packs';
  if v is not null and nullif(btrim(v), '') is not null then
    begin j := v::jsonb; exception when others then j := null; end;
    if j = $json$[{"id":"ef-100","name":"100 Kontör","units":100,"priceNetTry":100,"active":true,"order":10},
{"id":"ef-500","name":"500 Kontör","units":500,"priceNetTry":475,"active":true,"order":20},
{"id":"ef-1000","name":"1.000 Kontör","units":1000,"priceNetTry":900,"active":true,"popular":true,"order":30},
{"id":"ef-2500","name":"2.500 Kontör","units":2500,"priceNetTry":2125,"active":true,"order":40},
{"id":"ef-5000","name":"5.000 Kontör","units":5000,"priceNetTry":4000,"active":true,"order":50}]$json$::jsonb then
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
