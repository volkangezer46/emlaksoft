-- Rollback: 20260826001100_ef_plan_credit_values. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz migrationin yazdigi degerlere esit olanlar geri alinir (admin sonradan degistirdiyse korunur).
do $$
declare
  v text; j jsonb; plans jsonb; p jsonb; k text;
  seat jsonb := '{"advisor":5,"office":6,"professional":6}'::jsonb;
begin
  select value into v from public.platform_settings where key = 'billing.plan_definitions';
  if v is null or nullif(btrim(v), '') is null then return; end if;
  begin j := v::jsonb; exception when others then return; end;
  if jsonb_typeof(j -> 'plans') is distinct from 'object' then return; end if;
  plans := j -> 'plans';
  for k in select jsonb_object_keys(plans) loop
    p := plans -> k;
    if jsonb_typeof(p) is distinct from 'object' then continue; end if;
    if seat ? k and (p -> 'efCreditsPerExtraSeat') = (seat -> k) then
      p := p - 'efCreditsPerExtraSeat';
    end if;
    if k = 'business' and (p -> 'efCreditsMonthly') = '240'::jsonb then
      p := jsonb_set(p, '{efCreditsMonthly}', '300'::jsonb);
    end if;
    plans := jsonb_set(plans, array[k], p);
  end loop;
  if plans is distinct from (j -> 'plans') then
    update public.platform_settings set value = jsonb_set(j, '{plans}', plans)::text, updated_at = now()
     where key = 'billing.plan_definitions';
  end if;
end $$;