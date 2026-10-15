-- Geri alma: 20261016090100_publish_gate_portfolio_counts.sql
-- portfolio_counts ve transition_property_status_atomic onceki govdelerine (20261012002200 / 20260813000000) doner,
-- property_portal_presence kaldirilir. Veri degismez. 20261016090000 geri alinacaksa ONCE bu dosya uygulanir.
-- KOD: uygulama kapisi (publishBlockReasons) yerinde kalir; RPC 'publish_blocked' dondurmez, eski sayim alanlari
-- (sale_stock_value vb.) gelmezse portfoy listesi karti "—" gosterir (sahte toplam yok).
set local lock_timeout = '5s';

create or replace function public.portfolio_counts(
  p_owner_ids uuid[] default null,
  p_live text[] default '{}',
  p_pending text[] default '{}',
  p_draft text[] default '{}',
  p_green text[] default '{}',
  p_yellow text[] default '{}',
  p_red text[] default '{}',
  p_recent_since timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or public.current_tenant_id() is null then null else (
    select jsonb_build_object(
      'total', count(*),
      'live', count(*) filter (where p.status = any(p_live)),
      'pending', count(*) filter (where p.status = any(p_pending)),
      'draft', count(*) filter (where p.status = any(p_draft)),
      'sale', count(*) filter (where p.transaction_type = 'Satılık'),
      'rent', count(*) filter (where p.transaction_type = 'Kiralık'),
      'recent', count(*) filter (where p_recent_since is not null and p.created_at >= p_recent_since),
      'green', count(*) filter (where p.price_health = any(p_green)),
      'yellow', count(*) filter (where p.price_health = any(p_yellow)),
      'red', count(*) filter (where p.price_health = any(p_red))
    )
    from public.properties p
    where p.tenant_id = public.current_tenant_id()
      and p.deleted_at is null
      and (p_owner_ids is null or p.assigned_to = any(p_owner_ids))
  ) end;
$$;

create or replace function public.transition_property_status_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_property_ids uuid[],
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_expected integer;
  v_found integer;
  v_updated integer;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  v_expected := coalesce(cardinality(p_property_ids), 0);
  if p_tenant_id is null or p_actor_id is null or v_expected not between 1 and 50
     or v_status not in (
       'draft', 'pending_docs', 'pending_auth', 'photo_needed', 'ready', 'active',
       'live', 'passive', 'reserved', 'deposit', 'in_progress', 'withdrawn',
       'auth_expired', 'archived'
     )
     or char_length(coalesce(p_reason, '')) > 500
     or exists (select 1 from unnest(p_property_ids) x where x is null)
     or (select count(distinct x) from unnest(p_property_ids) x) <> v_expected then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select count(*) into v_found from (
    select p.id from public.properties p
    where p.tenant_id = p_tenant_id and p.id = any(p_property_ids)
      and p.deleted_at is null
    for update
  ) locked;
  if v_found <> v_expected then return jsonb_build_object('outcome', 'not_found'); end if;
  if exists (
    select 1 from public.properties p
    where p.tenant_id = p_tenant_id and p.id = any(p_property_ids)
      and p.status in ('sold', 'rented')
  ) then
    return jsonb_build_object('outcome', 'terminal_requires_workflow');
  end if;

  perform set_config('app.property_status_actor', p_actor_id::text, true);
  perform set_config('app.property_status_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  update public.properties
  set status = v_status,
      updated_at = v_now,
      published_at = case
        when v_status = 'live' and published_at is null then v_now
        else published_at end
  where tenant_id = p_tenant_id and id = any(p_property_ids)
    and status is distinct from v_status;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('outcome', 'replay', 'updated_count', 0);
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, new_value
  ) values (
    p_tenant_id, p_actor_id, 'property.status.bulk', 'property',
    jsonb_build_object('ids', to_jsonb(p_property_ids), 'status', v_status,
      'count', v_updated, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
  return jsonb_build_object('outcome', 'applied', 'updated_count', v_updated);
end;
$function$;

revoke all on function public.transition_property_status_atomic(uuid, uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.transition_property_status_atomic(uuid, uuid, uuid[], text, text) to service_role;

drop function if exists public.property_portal_presence(text, text);
