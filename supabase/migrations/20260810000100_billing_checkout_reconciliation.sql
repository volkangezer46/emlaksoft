-- Forward-only billing hardening:
--   * abandoned provider checkouts remain non-collectible invoice drafts,
--   * verified captures survive a later fulfillment rollback,
--   * subscription renewals extend the existing entitlement period,
--   * payment-link relationships are tenant-bound at the database boundary.

-- ---------------------------------------------------------------------------
-- Checkout lifecycle (a draft is never dunning debt)

alter table public.invoices
  add column if not exists checkout_status text,
  add column if not exists checkout_initialized_at timestamptz,
  add column if not exists checkout_expires_at timestamptz;

alter table public.invoices
  drop constraint if exists invoices_checkout_status_check,
  add constraint invoices_checkout_status_check check (
    checkout_status is null or checkout_status in (
      'pending_checkout',
      'initialized',
      'initialization_failed',
      'captured_pending',
      'fulfilled',
      'expired'
    )
  ) not valid;

alter table public.invoices validate constraint invoices_checkout_status_check;

create index if not exists idx_invoices_stale_checkout
  on public.invoices (checkout_expires_at)
  where status = 'draft'
    and checkout_status in ('pending_checkout', 'initialized', 'initialization_failed');

alter table public.payment_links
  add column if not exists checkout_conversation_id text,
  add column if not exists checkout_initialized_at timestamptz;

create unique index if not exists uq_payment_links_checkout_conversation
  on public.payment_links (checkout_conversation_id)
  where checkout_conversation_id is not null;

-- ---------------------------------------------------------------------------
-- Tenant-bound payment-link relationships

-- Repair legacy cross-tenant references before validating the new composite
-- constraints. The link and its payment history remain; only the invalid
-- optional association is detached and the repair is recorded without PII.
update public.payment_links pl
set
  customer_id = null,
  meta = pl.meta || jsonb_build_object('tenantReferenceRepairedAt', now())
where pl.customer_id is not null
  and not exists (
    select 1 from public.customers c
    where c.id = pl.customer_id and c.tenant_id = pl.tenant_id
  );

update public.payment_links pl
set
  commission_id = null,
  meta = pl.meta || jsonb_build_object('tenantReferenceRepairedAt', now())
where pl.commission_id is not null
  and not exists (
    select 1 from public.commissions c
    where c.id = pl.commission_id and c.tenant_id = pl.tenant_id
  );

update public.payment_links pl
set
  created_by = null,
  meta = pl.meta || jsonb_build_object('tenantReferenceRepairedAt', now())
where pl.created_by is not null
  and not exists (
    select 1 from public.profiles p
    where p.id = pl.created_by and p.tenant_id = pl.tenant_id
  );

create unique index if not exists uq_customers_tenant_id_id
  on public.customers (tenant_id, id);
create unique index if not exists uq_commissions_tenant_id_id
  on public.commissions (tenant_id, id);
create unique index if not exists uq_profiles_tenant_id_id
  on public.profiles (tenant_id, id);

alter table public.payment_links
  add constraint payment_links_tenant_customer_fkey
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id)
    not valid,
  add constraint payment_links_tenant_commission_fkey
    foreign key (tenant_id, commission_id)
    references public.commissions (tenant_id, id)
    not valid,
  add constraint payment_links_tenant_creator_fkey
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    not valid;

alter table public.payment_links
  validate constraint payment_links_tenant_customer_fkey,
  validate constraint payment_links_tenant_commission_fkey,
  validate constraint payment_links_tenant_creator_fkey;

-- ---------------------------------------------------------------------------
-- Durable captured-payment reconciliation state machine

create table if not exists public.billing_payment_captures (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'iyzico'),
  conversation_id text not null
    check (char_length(btrim(conversation_id)) between 1 and 512),
  payment_id text not null
    check (char_length(btrim(payment_id)) between 1 and 512),
  source text not null check (source in ('callback', 'webhook')),
  target_type text not null check (target_type in ('subscription', 'payment_link')),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_link_id uuid references public.payment_links(id) on delete set null,
  amount_try numeric not null check (amount_try > 0),
  currency text not null check (currency = 'TRY'),
  status text not null default 'captured_pending' check (status in (
    'captured_pending',
    'retry_pending',
    'manual_review',
    'refund_required',
    'refunded',
    'fulfilled'
  )),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error_code text
    check (last_error_code is null or char_length(last_error_code) <= 120),
  captured_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  refunded_at timestamptz,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  unique (provider, payment_id)
);

create index if not exists idx_billing_payment_captures_conversation
  on public.billing_payment_captures (provider, conversation_id, captured_at desc);

create index if not exists idx_billing_payment_captures_reconcile
  on public.billing_payment_captures (status, captured_at)
  where status in ('captured_pending', 'retry_pending', 'manual_review', 'refund_required');

create index if not exists idx_billing_payment_captures_tenant
  on public.billing_payment_captures (tenant_id, captured_at desc);

alter table public.billing_payment_captures enable row level security;
revoke all privileges on table public.billing_payment_captures
  from public, anon, authenticated;
grant all privileges on table public.billing_payment_captures to service_role;

create policy billing_payment_captures_deny_clients
  on public.billing_payment_captures
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.billing_payment_captures is
  'Service-role reconciliation ledger for provider-confirmed captures. Contains identifiers and money only; never raw provider payload, card data or buyer PII.';

create or replace function public.record_billing_payment_capture(
  p_provider text,
  p_conversation_id text,
  p_payment_id text,
  p_target_type text,
  p_expected_tenant_id uuid,
  p_expected_amount_try numeric,
  p_expected_currency text,
  p_source text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := btrim(coalesce(p_payment_id, ''));
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_currency text := upper(btrim(coalesce(p_expected_currency, '')));
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_invoice_id uuid;
  v_payment_link_id uuid;
  v_row public.billing_payment_captures%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider <> 'iyzico'
    or v_source not in ('callback', 'webhook')
    or v_target_type not in ('subscription', 'payment_link')
    or v_conversation_id = ''
    or char_length(v_conversation_id) > 512
    or v_payment_id = ''
    or char_length(v_payment_id) > 512
    or p_expected_tenant_id is null
    or p_expected_amount_try is null
    or p_expected_amount_try <= 0
    or v_currency <> 'TRY' then
    raise exception 'Invalid captured payment contract.' using errcode = '22023';
  end if;

  if v_target_type = 'subscription' then
    if left(v_conversation_id, 6) = 'plink-' then
      raise exception 'Captured payment target mismatch.' using errcode = '22023';
    end if;
    select i.id into v_invoice_id
    from public.invoices i
    where i.tenant_id = p_expected_tenant_id
      and i.meta ->> 'conversationId' = v_conversation_id
    order by i.created_at desc, i.id desc
    limit 1;
  else
    if left(v_conversation_id, 6) <> 'plink-' then
      raise exception 'Captured payment target mismatch.' using errcode = '22023';
    end if;
    select pl.id into v_payment_link_id
    from public.payment_links pl
    where pl.tenant_id = p_expected_tenant_id
      and pl.token = substring(v_conversation_id from 7)
    limit 1;
  end if;

  insert into public.billing_payment_captures (
    provider,
    conversation_id,
    payment_id,
    source,
    target_type,
    tenant_id,
    invoice_id,
    payment_link_id,
    amount_try,
    currency
  ) values (
    v_provider,
    v_conversation_id,
    v_payment_id,
    v_source,
    v_target_type,
    p_expected_tenant_id,
    v_invoice_id,
    v_payment_link_id,
    p_expected_amount_try,
    v_currency
  )
  on conflict (provider, payment_id) do update
  set
    last_seen_at = now(),
    attempt_count = public.billing_payment_captures.attempt_count + 1
  returning * into v_row;

  if v_row.conversation_id is distinct from v_conversation_id
    or v_row.payment_id is distinct from v_payment_id
    or v_row.target_type is distinct from v_target_type
    or v_row.tenant_id is distinct from p_expected_tenant_id
    or abs(v_row.amount_try - p_expected_amount_try) > 0.01
    or v_row.currency is distinct from v_currency then
    raise exception 'Captured payment identity conflict.' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'ok', true,
    'captureId', v_row.id::text,
    'status', v_row.status,
    'already', v_row.attempt_count > 1
  );
end;
$$;

revoke all privileges on function public.record_billing_payment_capture(
  text, text, text, text, uuid, numeric, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_billing_payment_capture(
  text, text, text, text, uuid, numeric, text, text
) to service_role;

create or replace function public.transition_billing_payment_capture(
  p_capture_id uuid,
  p_status text,
  p_error_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 120), '');
  v_row public.billing_payment_captures%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if v_status not in ('fulfilled', 'retry_pending', 'manual_review', 'refund_required', 'refunded') then
    raise exception 'Invalid capture status.' using errcode = '22023';
  end if;

  select * into v_row
  from public.billing_payment_captures c
  where c.id = p_capture_id
  for update;
  if not found then
    raise exception 'Captured payment not found.' using errcode = 'P0002';
  end if;

  if (v_row.status = 'fulfilled' and v_status <> 'fulfilled')
    or (v_row.status = 'refunded' and v_status <> 'refunded')
    or (v_row.status = 'refund_required' and v_status not in ('refund_required', 'refunded', 'manual_review')) then
    raise exception 'Invalid captured payment transition.' using errcode = '22023';
  end if;

  update public.billing_payment_captures c
  set
    status = v_status,
    last_error_code = case when v_status = 'fulfilled' then null else v_error_code end,
    last_seen_at = now(),
    fulfilled_at = case when v_status = 'fulfilled' then coalesce(c.fulfilled_at, now()) else c.fulfilled_at end,
    refunded_at = case when v_status = 'refunded' then coalesce(c.refunded_at, now()) else c.refunded_at end
  where c.id = p_capture_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'captureId', v_row.id::text, 'status', v_row.status);
end;
$$;

revoke all privileges on function public.transition_billing_payment_capture(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_billing_payment_capture(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Authoritative plan-change preflight (the existing tenant trigger remains the
-- final race-safe enforcement boundary at fulfillment time).

create or replace function public.billing_plan_change_preflight(
  p_tenant_id uuid,
  p_plan text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_limits record;
  v_seats bigint;
  v_customers bigint;
  v_properties bigint;
  v_branches bigint;
  v_blockers jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id;
  if not found then raise exception 'Tenant not found.' using errcode = 'P0002'; end if;

  select pe.seat_limit, pe.customer_limit, pe.active_property_limit, pe.branch_limit
  into v_limits
  from public.plan_entitlements pe
  where pe.plan = v_plan;
  if not found then raise exception 'Plan entitlement not found.' using errcode = '22023'; end if;

  select count(*) into v_seats from public.profiles
  where tenant_id = p_tenant_id and is_active = true;
  select count(*) into v_customers from public.customers
  where tenant_id = p_tenant_id and deleted_at is null;
  select count(*) into v_properties from public.properties
  where tenant_id = p_tenant_id and deleted_at is null
    and status in ('draft', 'live', 'reserved');
  select count(*) into v_branches from public.branches
  where tenant_id = p_tenant_id and is_active = true;

  if v_limits.seat_limit is not null and v_seats > v_limits.seat_limit then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'metric', 'seats', 'usage', v_seats, 'limit', v_limits.seat_limit
    ));
  end if;
  if v_limits.customer_limit is not null and v_customers > v_limits.customer_limit then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'metric', 'customers', 'usage', v_customers, 'limit', v_limits.customer_limit
    ));
  end if;
  if v_limits.active_property_limit is not null and v_properties > v_limits.active_property_limit then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'metric', 'active_properties', 'usage', v_properties, 'limit', v_limits.active_property_limit
    ));
  end if;
  if v_limits.branch_limit is not null and v_branches > v_limits.branch_limit then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'metric', 'branches', 'usage', v_branches, 'limit', v_limits.branch_limit
    ));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'tenantId', p_tenant_id::text,
    'plan', v_plan,
    'blockers', v_blockers
  );
end;
$$;

revoke all privileges on function public.billing_plan_change_preflight(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.billing_plan_change_preflight(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Fulfillment v2 wrapper. It opens a draft only after an iyzico capture has a
-- durable ledger claim, delegates the existing atomic fulfillment, and then
-- corrects renewal periods to extend from max(current_period_end, now()).

create or replace function public.fulfill_billing_payment_v2(
  p_provider text,
  p_conversation_id text,
  p_payment_id text default null,
  p_source text default 'webhook',
  p_target_type text default 'subscription',
  p_expected_tenant_id uuid default null,
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_expected_amount_try numeric default null,
  p_expected_currency text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_now timestamptz := now();
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_period_base timestamptz;
  v_period_end timestamptz;
  v_cycle text;
  v_tenant_id uuid;
  v_invoice_id uuid;
  v_updated_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_event_id uuid;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider = 'iyzico' then
    perform 1
    from public.billing_payment_captures c
    where c.provider = v_provider
      and c.conversation_id = v_conversation_id
      and c.payment_id = v_payment_id
      and c.target_type = v_target_type
      and c.tenant_id = p_expected_tenant_id
      and c.status in ('captured_pending', 'retry_pending', 'manual_review', 'fulfilled');
    if not found then
      raise exception 'Durable captured payment claim required.' using errcode = '55000';
    end if;
  end if;

  if v_target_type = 'subscription' then
    if p_expected_tenant_id is null then
      raise exception 'Subscription tenant is required.' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('plan-capacity:' || p_expected_tenant_id::text, 0)
    );

    select s.current_period_start, s.current_period_end
    into v_previous_start, v_previous_end
    from public.subscriptions s
    where s.tenant_id = p_expected_tenant_id
    for update;

    update public.invoices i
    set
      status = 'open',
      checkout_status = 'captured_pending'
    where i.tenant_id = p_expected_tenant_id
      and i.meta ->> 'conversationId' = v_conversation_id
      and i.status = 'draft'
      and (
        (v_provider = 'demo' and i.checkout_status = 'pending_checkout')
        or (v_provider = 'iyzico' and i.checkout_status = 'initialized')
      );
  end if;

  v_result := public.fulfill_billing_payment(
    p_provider,
    p_conversation_id,
    p_payment_id,
    p_source,
    p_target_type,
    p_expected_tenant_id,
    p_expected_plan,
    p_expected_cycle,
    p_expected_amount_try,
    p_expected_currency
  );

  if v_target_type = 'subscription' and coalesce((v_result ->> 'already')::boolean, false) = false then
    v_tenant_id := (v_result ->> 'tenantId')::uuid;
    v_invoice_id := (v_result ->> 'invoiceId')::uuid;
    v_cycle := lower(btrim(v_result ->> 'cycle'));
    v_period_base := greatest(coalesce(v_previous_end, v_now), v_now);
    v_period_end := case
      when v_cycle = 'yearly' then v_period_base + interval '1 year'
      else v_period_base + interval '1 month'
    end;

    update public.subscriptions s
    set
      current_period_start = case
        when v_previous_end is not null and v_previous_end > v_now
          then coalesce(v_previous_start, v_now)
        else v_now
      end,
      current_period_end = v_period_end,
      updated_at = v_now
    where s.tenant_id = v_tenant_id
    returning s.id into v_updated_subscription_id;

    if v_updated_subscription_id is null then
      raise exception 'Renewed subscription could not be extended.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      period_start = v_period_base,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      checkout_status = 'fulfilled'
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Renewal invoice period could not be updated.' using errcode = '55000';
    end if;

    v_result := v_result || jsonb_build_object(
      'periodStart', v_period_base,
      'periodEnd', v_period_end
    );

    update public.billing_fulfillment_events e
    set result = v_result
    where e.provider = v_provider and e.conversation_id = v_conversation_id
    returning e.id into v_updated_event_id;

    if v_updated_event_id is null then
      raise exception 'Renewal event result could not be updated.' using errcode = '55000';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all privileges on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) to service_role;

create or replace function public.expire_stale_billing_checkouts(p_limit integer default 500)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 5000 then
    raise exception 'Invalid cleanup limit.' using errcode = '22023';
  end if;

  with stale as (
    select i.id
    from public.invoices i
    where i.status = 'draft'
      and i.checkout_status in ('pending_checkout', 'initialized', 'initialization_failed')
      and i.checkout_expires_at <= now()
    order by i.checkout_expires_at
    limit p_limit
    for update skip locked
  )
  update public.invoices i
  set status = 'void', checkout_status = 'expired'
  from stale
  where i.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all privileges on function public.expire_stale_billing_checkouts(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_billing_checkouts(integer) to service_role;

comment on function public.expire_stale_billing_checkouts(integer) is
  'Bounded cleanup primitive for the operations scheduler; no schedule is installed by this migration.';

notify pgrst, 'reload schema';
