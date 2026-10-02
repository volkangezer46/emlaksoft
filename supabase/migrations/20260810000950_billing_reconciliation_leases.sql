-- Forward-only reconciliation worker hardening:
--   * one worker owns a capture at a time,
--   * crashed workers are reclaimed after a bounded lease,
--   * provider observations and reconciliation attempts are counted separately,
--   * exhausted captures fail closed into the manual-review queue.

alter table public.billing_payment_captures
  add column if not exists reconciliation_attempt_count integer not null default 0,
  add column if not exists reconciliation_started_at timestamptz,
  add column if not exists reconciliation_worker_id uuid;

alter table public.billing_payment_captures
  drop constraint if exists billing_payment_captures_reconciliation_attempt_count_check,
  add constraint billing_payment_captures_reconciliation_attempt_count_check
    check (reconciliation_attempt_count >= 0) not valid;

alter table public.billing_payment_captures
  validate constraint billing_payment_captures_reconciliation_attempt_count_check;

create or replace function public.claim_billing_payment_captures(
  p_limit integer,
  p_worker_id uuid
)
returns setof public.billing_payment_captures
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 or p_worker_id is null then
    raise exception 'Invalid reconciliation claim.' using errcode = '22023';
  end if;

  -- A capture receives at most six worker attempts. Stale sixth attempts are
  -- surfaced for operations instead of being reclaimed forever.
  update public.billing_payment_captures c
  set
    status = 'manual_review',
    last_error_code = 'retry_limit',
    last_seen_at = now(),
    reconciliation_started_at = null,
    reconciliation_worker_id = null
  where c.status in ('captured_pending', 'retry_pending')
    and (
      c.reconciliation_started_at is null
      or c.reconciliation_started_at <= now() - interval '15 minutes'
    )
    and c.reconciliation_attempt_count >= 6;

  return query
  with candidates as (
    select c.id
    from public.billing_payment_captures c
    where c.status in ('captured_pending', 'retry_pending')
      and (
        c.reconciliation_started_at is null
        or c.reconciliation_started_at <= now() - interval '15 minutes'
      )
      and c.reconciliation_attempt_count < 6
    order by c.captured_at, c.id
    limit p_limit
    for update skip locked
  )
  update public.billing_payment_captures c
  set
    reconciliation_attempt_count = c.reconciliation_attempt_count + 1,
    reconciliation_started_at = now(),
    reconciliation_worker_id = p_worker_id,
    last_seen_at = now()
  from candidates
  where c.id = candidates.id
  returning c.*;
end;
$$;

revoke all privileges on function public.claim_billing_payment_captures(integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_billing_payment_captures(integer, uuid)
  to service_role;

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
    or (v_row.status = 'refund_required' and v_status not in ('refund_required', 'refunded', 'manual_review'))
    or (v_row.status = 'manual_review' and v_status not in ('manual_review', 'refund_required', 'refunded', 'fulfilled')) then
    raise exception 'Invalid captured payment transition.' using errcode = '22023';
  end if;

  update public.billing_payment_captures c
  set
    status = v_status,
    last_error_code = case when v_status = 'fulfilled' then null else v_error_code end,
    last_seen_at = now(),
    fulfilled_at = case when v_status = 'fulfilled' then coalesce(c.fulfilled_at, now()) else c.fulfilled_at end,
    refunded_at = case when v_status = 'refunded' then coalesce(c.refunded_at, now()) else c.refunded_at end,
    reconciliation_started_at = null,
    reconciliation_worker_id = null
  where c.id = p_capture_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'captureId', v_row.id::text, 'status', v_row.status);
end;
$$;

revoke all privileges on function public.transition_billing_payment_capture(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_billing_payment_capture(uuid, text, text)
  to service_role;

comment on function public.claim_billing_payment_captures(integer, uuid) is
  'Atomically leases a bounded captured-payment batch to one reconciliation worker; stale leases are reclaimable after 15 minutes.';

notify pgrst, 'reload schema';
