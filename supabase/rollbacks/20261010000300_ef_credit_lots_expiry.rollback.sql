-- 20261010000300 geri alma: sureli kontor partilerini kaldirir, cuzdan RPC govdelerini 20260826000100 / 20260826001200
-- (CANLI son tanim, pg_get_functiondef, 2026-10-10) haline dondurur.
-- UYARI: lot tablosu silinir -> parti bazli son kullanma bilgisi KAYBOLUR. Defter (account_credit_ledger) hic degismedi:
--   bakiye yeniden "grant - spend" olur. Suresi dolup YANMIS kontor (source 'expire' spend satirlari) defterde kalir;
--   geri almadan once yanan kontorun iadesi gerekiyorsa admin yuklemesiyle (kind admin) verilir.
-- Geri alma sirasi: once kod (onceki surum), sonra bu dosya.
set local lock_timeout = '5s';

drop function if exists public.ef_credit_lots_ready();
drop function if exists public.ef_credit_burn_expired(integer, interval);

CREATE OR REPLACE FUNCTION public.ef_credit_balance(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_granted bigint;
  v_spent bigint;
  v_reserved bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  -- Tek SELECT = tek anlik goruntu: kesinlestirme (spend satiri + state degisimi) yarim gorulmez.
  select
    coalesce((
      select sum(l.amount) from public.account_credit_ledger l
      where l.tenant_id = p_tenant and l.unit = 'ef' and l.entry_type = 'grant'
    ), 0)::bigint,
    coalesce((
      select -sum(l.amount) from public.account_credit_ledger l
      where l.tenant_id = p_tenant and l.unit = 'ef' and l.entry_type = 'spend'
    ), 0)::bigint,
    coalesce((
      select sum(r.units) from public.ef_credit_reservations r
      where r.tenant_id = p_tenant and r.state = 'reserved'
    ), 0)::bigint
  into v_granted, v_spent, v_reserved;

  return jsonb_build_object(
    'available', v_granted - v_spent - v_reserved,
    'reserved', v_reserved,
    'granted_total', v_granted,
    'committed_total', v_spent
  );
end;
$function$;

revoke all on function public.ef_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.ef_credit_balance(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.ef_credit_commit(p_tenant uuid, p_reservation uuid, p_ref jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.ef_credit_reservations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_reservation is null then
    raise exception 'Tenant and reservation are required.' using errcode = '22023';
  end if;
  if p_ref is not null and (jsonb_typeof(p_ref) <> 'object' or octet_length(p_ref::text) > 4000) then
    raise exception 'Invalid ref.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  select r.* into v_row
  from public.ef_credit_reservations r
  where r.tenant_id = p_tenant and r.id = p_reservation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'state', 'unknown', 'already', false);
  end if;

  if v_row.state = 'committed' then
    if v_row.ref is null and p_ref is not null then
      update public.ef_credit_reservations r set ref = p_ref where r.id = v_row.id;
    end if;
    return jsonb_build_object('ok', true, 'state', 'committed', 'already', true);
  end if;

  if v_row.state = 'released' then
    return jsonb_build_object('ok', false, 'state', 'released', 'already', false);
  end if;

  -- reserved -> committed: defter spend satiri (rezerv kimligiyle tekil) + durum. available DEGISMEZ.
  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, created_by, feature)
  values
    (p_tenant, 'ef', 'spend', -v_row.units, 'usage', v_row.id, 'ef:spend:' || v_row.id::text, v_row.user_id, v_row.item);

  update public.ef_credit_reservations r
  set state = 'committed', settled_at = now(), ref = coalesce(p_ref, r.ref)
  where r.id = v_row.id;

  return jsonb_build_object('ok', true, 'state', 'committed', 'already', false);
end;
$function$;

revoke all on function public.ef_credit_commit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ef_credit_commit(uuid, uuid, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.ef_credit_grant(p_tenant uuid, p_units integer, p_kind text, p_idem text, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source text;
  v_key text;
  v_existing_amount numeric;
  v_existing_feature text;
  v_available bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_units is null or p_units < 1 or p_units > 1000000 then
    raise exception 'Invalid units.' using errcode = '22023';
  end if;
  -- config.ts EF_GRANT_KINDS -> defter source (CHECK listesinde)
  v_source := case p_kind
    when 'purchase' then 'purchase'
    when 'plan_monthly' then 'plan'
    when 'bonus' then 'bonus'
    when 'admin' then 'manual'
    when 'refund' then 'refund'
  end;
  if v_source is null then
    raise exception 'Invalid grant kind.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 4000) then
    raise exception 'Invalid meta.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  v_key := 'ef:grant:' || p_tenant::text || ':' || p_idem;

  select l.amount, l.feature into v_existing_amount, v_existing_feature
  from public.account_credit_ledger l
  where l.idempotency_key = v_key;

  if found then
    if v_existing_amount <> p_units or v_existing_feature is distinct from ('ef_grant:' || p_kind) then
      raise exception 'Idempotency key reused with a different grant.' using errcode = '22023';
    end if;
    v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
    return jsonb_build_object('ok', true, 'already', true, 'available', v_available);
  end if;

  -- Suresiz kontor (v1): expires_at yazilmaz.
  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, feature, meta)
  values
    (p_tenant, 'ef', 'grant', p_units, v_source, v_key, 'ef_grant:' || p_kind, p_meta);

  v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
  return jsonb_build_object('ok', true, 'already', false, 'available', v_available);
end;
$function$;

revoke all on function public.ef_credit_grant(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ef_credit_grant(uuid, integer, text, text, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.ef_credit_expire_plan(p_tenant uuid, p_keep integer, p_idem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function public.ef_credit_expire_plan(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.ef_credit_expire_plan(uuid, integer, text) to service_role;

drop table if exists public.ef_credit_lots;
drop function if exists public.ef_credit_lots_guard();

notify pgrst, 'reload schema';
