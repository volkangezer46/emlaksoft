-- Authorization hardening: keep application and SQL permission evaluation in
-- sync, bind SECURITY DEFINER analytics RPCs to the JWT tenant, and expose
-- destructive maintenance RPCs only to trusted server code.

-- ---------------------------------------------------------------------------
-- Effective permissions
-- ---------------------------------------------------------------------------

create or replace function public.has_effective_permission(
  p_module text,
  p_action text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    case
      when public.current_profile_role() <> 'owner' then (
        select p_action = any(u.actions)
        from public.user_permission_overrides u
        where u.tenant_id = public.current_tenant_id()
          and u.user_id = auth.uid()
          and u.module = p_module
          and (u.expires_at is null or u.expires_at > now())
        limit 1
      )
    end,
    (
      select trp.allowed
      from public.tenant_role_permissions trp
      where trp.tenant_id = public.current_tenant_id()
        and trp.role = public.current_profile_role()
        and trp.module = p_module
        and trp.action = p_action
      limit 1
    ),
    exists (
      select 1
      from public.permission_defaults pd
      where pd.role = public.current_profile_role()
        and pd.module = p_module
        and pd.action = p_action
    ),
    false
  );
$$;

comment on function public.has_effective_permission(text, text) is
  'Effective permission: active per-user module replacement, then tenant role override, then role default. Owners ignore user overrides.';

-- This helper deliberately has no API grant. SECURITY DEFINER RPCs owned by
-- the migration owner can call it, while clients cannot use it as a probing
-- endpoint. A mismatching or missing JWT tenant always raises 42501.
create or replace function public.assert_current_tenant(p_tenant_id uuid)
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or p_tenant_id is distinct from v_tenant then
    raise exception 'Tenant scope mismatch.' using errcode = '42501';
  end if;

  return v_tenant;
end;
$$;

revoke all privileges on function public.assert_current_tenant(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tenant-bound SECURITY DEFINER analytics RPCs
-- ---------------------------------------------------------------------------

create or replace function public.customer_counts_by_advisor(p_tenant_id uuid)
returns table(assigned_to uuid, cnt bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.assigned_to, count(*)::bigint as cnt
  from public.customers c
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.deleted_at is null
    and c.assigned_to is not null
  group by c.assigned_to;
$$;

revoke all privileges on function public.customer_counts_by_advisor(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.customer_counts_by_advisor(uuid)
  to authenticated, service_role;

create or replace function public.customer_lead_signals(p_tenant_id uuid)
returns table(
  customer_id uuid,
  active_demands int,
  comms int,
  appts int,
  calls int,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    coalesce(d.cnt, 0)::int,
    coalesce(m.cnt, 0)::int,
    coalesce(a.cnt, 0)::int,
    coalesce(ca.cnt, 0)::int,
    greatest(m.last_at, a.last_at, ca.last_at)
  from public.customers c
  left join (
    select cd.customer_id, count(*) as cnt
    from public.customer_demands cd
    where cd.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ) d on d.customer_id = c.id
  left join (
    select cm.customer_id, count(*) as cnt, max(cm.created_at) as last_at
    from public.communications cm
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
    group by cm.customer_id
  ) m on m.customer_id = c.id
  left join (
    select ap.customer_id, count(*) as cnt, max(ap.scheduled_at) as last_at
    from public.appointments ap
    where ap.tenant_id = public.assert_current_tenant(p_tenant_id)
    group by ap.customer_id
  ) a on a.customer_id = c.id
  left join (
    select cl.customer_id, count(*) as cnt, max(cl.started_at) as last_at
    from public.calls cl
    where cl.tenant_id = public.assert_current_tenant(p_tenant_id)
    group by cl.customer_id
  ) ca on ca.customer_id = c.id
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.deleted_at is null;
$$;

revoke all privileges on function public.customer_lead_signals(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.customer_lead_signals(uuid)
  to authenticated, service_role;

create or replace function public.advisor_kpis(
  p_tenant_id uuid,
  p_month_start timestamptz
)
returns table(
  assigned_to uuid,
  customer_count bigint,
  call_count bigint,
  appoint_count bigint,
  offer_count bigint,
  deal_count bigint,
  revenue numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cust as (
    select c.assigned_to, count(*)::bigint as c
    from public.customers c
    where c.tenant_id = public.assert_current_tenant(p_tenant_id)
      and c.deleted_at is null
      and c.assigned_to is not null
    group by c.assigned_to
  ),
  cal as (
    select c.handled_by as uid, count(*)::bigint as c
    from public.calls c
    where c.tenant_id = public.assert_current_tenant(p_tenant_id)
      and c.started_at >= p_month_start
      and c.handled_by is not null
    group by c.handled_by
  ),
  appt as (
    select a.assigned_to as uid, count(*)::bigint as c
    from public.appointments a
    where a.tenant_id = public.assert_current_tenant(p_tenant_id)
      and a.scheduled_at >= p_month_start
      and a.assigned_to is not null
    group by a.assigned_to
  ),
  off as (
    select o.created_by as uid,
           count(*)::bigint as c,
           count(*) filter (where o.status = 'accepted')::bigint as accepted
    from public.offers o
    where o.tenant_id = public.assert_current_tenant(p_tenant_id)
      and o.created_at >= p_month_start
      and o.created_by is not null
    group by o.created_by
  ),
  comm as (
    select d.assigned_to as uid, coalesce(sum(cm.gross_amount), 0)::numeric as rev
    from public.commissions cm
    join public.deals d on d.id = cm.deal_id
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.created_at >= p_month_start
      and cm.status in ('paid', 'collected')
      and d.assigned_to is not null
    group by d.assigned_to
  ),
  ids as (
    select cust.assigned_to as uid from cust
    union select cal.uid from cal
    union select appt.uid from appt
    union select off.uid from off
    union select comm.uid from comm
  )
  select
    ids.uid as assigned_to,
    coalesce(cust.c, 0) as customer_count,
    coalesce(cal.c, 0) as call_count,
    coalesce(appt.c, 0) as appoint_count,
    coalesce(off.c, 0) as offer_count,
    coalesce(off.accepted, 0) as deal_count,
    coalesce(comm.rev, 0) as revenue
  from ids
  left join cust on cust.assigned_to = ids.uid
  left join cal on cal.uid = ids.uid
  left join appt on appt.uid = ids.uid
  left join off on off.uid = ids.uid
  left join comm on comm.uid = ids.uid;
$$;

revoke all privileges on function public.advisor_kpis(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.advisor_kpis(uuid, timestamptz)
  to authenticated, service_role;

create or replace function public.customer_heat_signals(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table(
  customer_id uuid,
  last_contact timestamptz,
  open_demands int,
  urgent_demands int,
  portal_likes_30d int,
  open_offers int,
  open_deals int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    greatest(m.last_at, a.last_at, ca.last_at),
    coalesce(d.cnt, 0)::int,
    coalesce(d.urgent, 0)::int,
    coalesce(pf.cnt, 0)::int,
    coalesce(o.cnt, 0)::int,
    coalesce(dl.cnt, 0)::int
  from public.customers c
  left join (
    select cd.customer_id,
           count(*) as cnt,
           count(*) filter (where cd.urgency in ('high', 'urgent')) as urgent
    from public.customer_demands cd
    where cd.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cd.customer_id = any(p_customer_ids)
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ) d on d.customer_id = c.id
  left join (
    select cm.customer_id, max(cm.created_at) as last_at
    from public.communications cm
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.customer_id = any(p_customer_ids)
    group by cm.customer_id
  ) m on m.customer_id = c.id
  left join (
    select ap.customer_id, max(ap.scheduled_at) as last_at
    from public.appointments ap
    where ap.tenant_id = public.assert_current_tenant(p_tenant_id)
      and ap.customer_id = any(p_customer_ids)
    group by ap.customer_id
  ) a on a.customer_id = c.id
  left join (
    select cl.customer_id, max(cl.started_at) as last_at
    from public.calls cl
    where cl.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cl.customer_id = any(p_customer_ids)
    group by cl.customer_id
  ) ca on ca.customer_id = c.id
  left join (
    select pmf.customer_id, count(*) as cnt
    from public.portal_match_feedback pmf
    where pmf.tenant_id = public.assert_current_tenant(p_tenant_id)
      and pmf.customer_id = any(p_customer_ids)
      and pmf.verdict = 'liked'
      and pmf.created_at >= now() - interval '30 days'
    group by pmf.customer_id
  ) pf on pf.customer_id = c.id
  left join (
    select o.customer_id, count(*) as cnt
    from public.offers o
    where o.tenant_id = public.assert_current_tenant(p_tenant_id)
      and o.customer_id = any(p_customer_ids)
      and o.status in ('draft', 'submitted', 'countered')
    group by o.customer_id
  ) o on o.customer_id = c.id
  left join (
    select d0.customer_id, count(*) as cnt
    from public.deals d0
    where d0.tenant_id = public.assert_current_tenant(p_tenant_id)
      and d0.customer_id = any(p_customer_ids)
      and d0.stage in ('new', 'qualified', 'negotiation')
    group by d0.customer_id
  ) dl on dl.customer_id = c.id
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.id = any(p_customer_ids)
    and c.deleted_at is null;
$$;

revoke all privileges on function public.customer_heat_signals(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.customer_heat_signals(uuid, uuid[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Destructive data-lifecycle RPCs: service role only
-- ---------------------------------------------------------------------------

create or replace function public.anonymize_customer(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_phone text;
  v_ref text;
  v_affected jsonb := '{}'::jsonb;
  v_n integer;
  c_placeholder constant text := '05000000000';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Tenant not found.' using errcode = '42501';
  end if;

  if p_actor_id is null or not (
    exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id and p.tenant_id = p_tenant_id
    )
    or exists (
      select 1
      from public.platform_staff ps
      where ps.id = p_actor_id and ps.is_active = true
    )
  ) then
    raise exception 'Actor is not authorized for this tenant.' using errcode = '42501';
  end if;

  select c.full_name, c.phone
    into v_name, v_phone
  from public.customers c
  where c.id = p_customer_id and c.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Customer not found in tenant.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.kvkk_erasure_log l
    where l.customer_id = p_customer_id and l.tenant_id = p_tenant_id
  ) then
    raise exception 'Customer was already anonymized.';
  end if;

  v_ref := coalesce(public.mask_name(v_name), 'Isimsiz')
    || ' - '
    || coalesce(public.mask_phone(v_phone), '-');

  update public.customers set
    full_name = 'Anonimlestirilmis kayit',
    phone = null,
    email = null,
    notes = null,
    birth_date = null,
    anniversary_date = null,
    anniversary_note = null,
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now()
  where id = p_customer_id and tenant_id = p_tenant_id;
  v_affected := v_affected || jsonb_build_object('customers', 1);

  update public.campaign_recipients
  set full_name = null, phone = c_placeholder
  where customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('campaign_recipients', v_n);
  end if;

  update public.open_house_visitors
  set full_name = 'Anonim', phone = null, email = null, notes = null
  where created_customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('open_house_visitors', v_n);
  end if;

  update public.calls
  set phone = c_placeholder, notes = null
  where customer_id = p_customer_id and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('calls', v_n);
  end if;

  update public.appointments
  set notes = null
  where customer_id = p_customer_id and tenant_id = p_tenant_id and notes is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('appointments', v_n);
  end if;

  update public.tasks
  set notes = null
  where customer_id = p_customer_id and tenant_id = p_tenant_id and notes is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('tasks', v_n);
  end if;

  update public.offers
  set notes = null
  where customer_id = p_customer_id and tenant_id = p_tenant_id and notes is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('offers', v_n);
  end if;

  update public.communications
  set body = null, subject = null
  where customer_id = p_customer_id and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('communications', v_n);
  end if;

  update public.iys_consents
  set status = 'denied', revoked_at = coalesce(revoked_at, now())
  where customer_id = p_customer_id
    and tenant_id = p_tenant_id
    and status <> 'denied';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('iys_consents', v_n);
  end if;

  delete from public.customer_portal_tokens
  where customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_affected := v_affected || jsonb_build_object('customer_portal_tokens', v_n);
  end if;

  insert into public.kvkk_erasure_log (
    tenant_id,
    customer_id,
    customer_ref,
    reason,
    actor_id,
    affected
  ) values (
    p_tenant_id,
    p_customer_id,
    v_ref,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_actor_id,
    v_affected
  );

  return jsonb_build_object('ok', true, 'ref', v_ref, 'affected', v_affected);
end;
$$;

comment on function public.anonymize_customer(uuid, uuid, text, uuid) is
  'Server-only KVKK anonymization. Tenant and actor are supplied by an authenticated Server Action and validated before mutation.';

create or replace function public.purge_stale_customers(
  p_tenant_id uuid,
  p_days integer,
  p_actor_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_days is null or p_days < 30 or p_days > 36500 then
    raise exception 'Retention days must be between 30 and 36500.';
  end if;

  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Tenant not found.' using errcode = '42501';
  end if;

  if p_actor_id is null or not (
    exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id and p.tenant_id = p_tenant_id
    )
    or exists (
      select 1
      from public.platform_staff ps
      where ps.id = p_actor_id and ps.is_active = true
    )
  ) then
    raise exception 'Actor is not authorized for this tenant.' using errcode = '42501';
  end if;

  for v_id in
    select c.id
    from public.customers c
    where c.tenant_id = p_tenant_id
      and c.deleted_at is not null
      and c.deleted_at < now() - make_interval(days => p_days)
      and not exists (
        select 1
        from public.kvkk_erasure_log l
        where l.customer_id = c.id and l.tenant_id = p_tenant_id
      )
  loop
    perform public.anonymize_customer(
      p_tenant_id,
      v_id,
      'Saklama suresi doldu (otomatik)',
      p_actor_id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.purge_stale_customers(uuid, integer, uuid) is
  'Server-only tenant retention purge. Calls the service-role-only anonymization RPC for each eligible customer.';

-- Old user-session signatures are retained only for migration compatibility;
-- no API role can execute them after this point.
revoke all privileges on function public.anonymize_customer(uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.purge_stale_customers(integer)
  from public, anon, authenticated, service_role;

revoke all privileges on function public.anonymize_customer(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.anonymize_customer(uuid, uuid, text, uuid)
  to service_role;

revoke all privileges on function public.purge_stale_customers(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_stale_customers(uuid, integer, uuid)
  to service_role;

-- CREATE FUNCTION grants EXECUTE to PUBLIC unless explicitly revoked. Keep
-- error-log retention callable by backend service code only.
revoke all privileges on function public.purge_old_error_logs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_old_error_logs(integer)
  to service_role;
