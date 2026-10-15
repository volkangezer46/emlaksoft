-- Geri alma: 20261016010000_finance_fx_inline.sql
-- finance_fx 20261014001100 gövdesine döner (SET search_path = ''; inline edilmez). Sonuçlar aynı, yalnız plan değişir.
set local lock_timeout = '5s';

create or replace function public.finance_fx(p_currency text, p_rates jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_currency is null or p_currency = 'TRY' then 1::numeric
    when p_rates is not null and pg_catalog.jsonb_typeof(p_rates -> p_currency) = 'number' and (p_rates ->> p_currency)::numeric > 0
      then (p_rates ->> p_currency)::numeric
    else null
  end;
$$;
