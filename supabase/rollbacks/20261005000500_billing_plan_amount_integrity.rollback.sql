-- Rollback: 20261005000500_billing_plan_amount_integrity (TASLAK; proposed dosyasiyla birlikte terfi eder)
-- Onceki canli govdelere AYNEN doner (kaynak migration dosyalarindan satir satir kopya):
--   update_tenant_plan_subscription  <- 20260802000300 (satir 894-1031)
--   fulfill_billing_payment (10 arg) <- 20260809000000 (satir 141-746)
--   provision_registration           <- 20260731000140 (satir 50-263) + K1 20260816010100 ifadesi
--   convert_demo_request_to_tenant   <- 20260802000400 (satir 5-320)  + K1 20260816010100 ifadesi
-- K1 notu: K1 canli govdede `interval '14 days'` ifadesini
-- `make_interval(days => public.platform_default_trial_days())` ile degistirdi; geri donulen hal bu K1 halidir
-- (K1'in kendi rollback'i daha sonra calisirsa ayni ifadeyi bulup 14 gune cevirebilir).
-- UYARI: geri alininca sabit 990/2490/5990/12900 ve yillik *12*0.8 yedegi GERI GELIR; admin plan/durum
-- degisimi kayitli tutari yeniden ezer; 'business' plan RPC'lerde yeniden reddedilir. Bu migration'in yazdigi
-- amount_try / price_lock_* DEGERLERI geri alinmaz (veri degisikligi yapilmaz; yalniz fonksiyonlar doner).
-- Yalniz restore edilebilir backup/PITR dogrulandiktan sonra sahibi uygular.

-- ---------------------------------------------------------------------------
-- update_tenant_plan_subscription (20260802000300 aynen)
-- ---------------------------------------------------------------------------
create or replace function public.update_tenant_plan_subscription(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_plan text,
  p_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old_plan text;
  v_old_status text;
  v_tenant_slug text;
  v_next_plan text;
  v_next_status text;
  v_subscription_status text;
  v_amount_try numeric;
  v_subscription_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_actor_id is null or not exists (
    select 1
    from public.platform_staff ps
    where ps.id = p_actor_id
      and ps.is_active = true
      and ps.role in ('super_admin', 'billing')
  ) then
    raise exception 'Active billing staff required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_plan), '') is not null
    and btrim(p_plan) not in ('advisor', 'office', 'professional', 'enterprise') then
    raise exception 'Invalid plan.' using errcode = '22023';
  end if;
  if nullif(btrim(p_status), '') is not null
    and btrim(p_status) not in ('trial', 'active', 'past_due', 'suspended', 'cancelled') then
    raise exception 'Invalid tenant status.' using errcode = '22023';
  end if;

  select t.plan, t.status, t.slug
    into v_old_plan, v_old_status, v_tenant_slug
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;

  v_next_plan := coalesce(nullif(btrim(p_plan), ''), v_old_plan);
  v_next_status := coalesce(nullif(btrim(p_status), ''), v_old_status);
  v_subscription_status := case v_next_status
    when 'trial' then 'trialing'
    when 'active' then 'active'
    when 'past_due' then 'past_due'
    when 'cancelled' then 'cancelled'
    else 'paused'
  end;
  v_amount_try := case v_next_plan
    when 'advisor' then 990
    when 'office' then 2490
    when 'professional' then 5990
    when 'enterprise' then 12900
  end;

  update public.tenants
  set plan = v_next_plan,
      status = v_next_status,
      updated_at = now()
  where id = p_tenant_id;

  update public.subscriptions
  set plan = v_next_plan,
      status = v_subscription_status,
      amount_try = v_amount_try,
      cancelled_at = case
        when v_subscription_status = 'cancelled' then coalesce(cancelled_at, now())
        else null
      end,
      updated_at = now()
  where tenant_id = p_tenant_id;
  get diagnostics v_subscription_count = row_count;

  if v_subscription_count <> 1 then
    raise exception 'Tenant subscription not found.' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    p_tenant_id,
    p_actor_id,
    'billing.tenant_plan_status',
    'tenant',
    p_tenant_id,
    jsonb_build_object('plan', v_old_plan, 'status', v_old_status),
    jsonb_build_object(
      'plan', v_next_plan,
      'status', v_next_status,
      'subscription_status', v_subscription_status,
      'monthly_amount_try', v_amount_try
    )
  );

  return jsonb_build_object(
    'tenantId', p_tenant_id::text,
    'tenantSlug', v_tenant_slug,
    'previousPlan', v_old_plan,
    'previousStatus', v_old_status,
    'plan', v_next_plan,
    'status', v_next_status,
    'subscriptionStatus', v_subscription_status,
    'monthlyAmountTry', v_amount_try
  );
end;
$$;

comment on function public.update_tenant_plan_subscription(uuid, uuid, text, text) is
  'Service-role-only atomic tenant lifecycle, canonical monthly subscription and audit update.';

revoke all privileges on function public.update_tenant_plan_subscription(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_tenant_plan_subscription(uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- fulfill_billing_payment 10 arg (20260809000000 aynen)
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_billing_payment(
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
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_expected_currency text := upper(btrim(coalesce(p_expected_currency, '')));
  v_event_id uuid;
  v_completed_event_id uuid;
  v_existing_event public.billing_fulfillment_events%rowtype;
  v_match_count integer;
  v_now timestamptz := now();
  v_result jsonb;

  v_invoice_id uuid;
  v_tenant_id uuid;
  v_invoice_status text;
  v_amount_try numeric;
  v_invoice_currency text;
  v_invoice_meta jsonb;
  v_plan text;
  v_cycle text;
  v_period_end timestamptz;
  v_tax_try numeric;
  v_total_try numeric;
  v_monthly_amount numeric;
  v_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_tenant_id uuid;

  v_link_token text;
  v_payment_link_id uuid;
  v_payment_link_tenant_id uuid;
  v_payment_link_commission_id uuid;
  v_payment_link_status text;
  v_payment_link_amount_try numeric;
  v_payment_link_expires_at timestamptz;
  v_updated_payment_link_id uuid;
  v_updated_commission_id uuid;
  v_notification_id uuid;
  v_commission_changed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider not in ('iyzico', 'demo') then
    raise exception 'Unsupported payment provider.' using errcode = '22023';
  end if;

  if v_conversation_id = '' or char_length(v_conversation_id) > 512 then
    raise exception 'Invalid conversation identity.' using errcode = '22023';
  end if;

  if v_payment_id is not null and char_length(v_payment_id) > 512 then
    raise exception 'Invalid payment identity.' using errcode = '22023';
  end if;

  if v_source not in ('callback', 'webhook', 'demo')
    or (v_provider = 'demo' and v_source <> 'demo')
    or (v_provider = 'iyzico' and v_source = 'demo') then
    raise exception 'Invalid fulfillment source.' using errcode = '22023';
  end if;

  if v_target_type not in ('subscription', 'payment_link') then
    raise exception 'Invalid fulfillment target.' using errcode = '22023';
  end if;

  if p_expected_amount_try is null or p_expected_amount_try <= 0 then
    raise exception 'Expected payment amount is required.' using errcode = '22023';
  end if;

  if v_expected_currency <> 'TRY' then
    raise exception 'Expected payment currency must be TRY.' using errcode = '22023';
  end if;

  if (v_target_type = 'payment_link' and left(v_conversation_id, 6) <> 'plink-')
    or (v_target_type = 'subscription' and left(v_conversation_id, 6) = 'plink-') then
    raise exception 'Conversation and fulfillment target do not match.' using errcode = '22023';
  end if;

  -- The unique insert is the race winner. A downstream exception rolls the
  -- claim back together with every side effect, allowing a safe provider retry.
  begin
    insert into public.billing_fulfillment_events (
      provider,
      conversation_id,
      payment_id,
      source,
      target_type,
      status
    ) values (
      v_provider,
      v_conversation_id,
      v_payment_id,
      v_source,
      v_target_type,
      'processing'
    )
    returning id into v_event_id;
  exception when unique_violation then
    select count(*)
      into v_match_count
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      );

    if v_match_count <> 1 then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    select e.*
      into v_existing_event
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      )
    limit 1;

    if v_existing_event.conversation_id is distinct from v_conversation_id
      or v_existing_event.target_type is distinct from v_target_type
      or (
        v_payment_id is not null
        and v_existing_event.payment_id is not null
        and v_existing_event.payment_id is distinct from v_payment_id
      ) then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    if v_existing_event.status <> 'completed' then
      raise exception 'Payment fulfillment is not complete.' using errcode = '55000';
    end if;

    if p_expected_tenant_id is not null
      and v_existing_event.result ->> 'tenantId' is distinct from p_expected_tenant_id::text then
      raise exception 'Completed payment tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(v_existing_event.result ->> 'plan'))
        is distinct from lower(btrim(p_expected_plan)) then
      raise exception 'Completed payment plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(v_existing_event.result ->> 'cycle'))
        is distinct from lower(btrim(p_expected_cycle)) then
      raise exception 'Completed payment cycle does not match.' using errcode = '22023';
    end if;

    if nullif(v_existing_event.result ->> 'amountTry', '') is null
      or abs((v_existing_event.result ->> 'amountTry')::numeric - p_expected_amount_try) > 0.01 then
      raise exception 'Completed payment amount does not match.' using errcode = '22023';
    end if;

    if upper(coalesce(v_existing_event.result ->> 'currency', '')) <> v_expected_currency then
      raise exception 'Completed payment currency does not match.' using errcode = '22023';
    end if;

    if v_existing_event.payment_id is null and v_payment_id is not null then
      update public.billing_fulfillment_events
      set payment_id = v_payment_id
      where id = v_existing_event.id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Existing fulfillment claim could not be updated.' using errcode = '55000';
      end if;
    end if;

    return coalesce(v_existing_event.result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'already', true);
  end;

  if v_target_type = 'subscription' then
    select
      i.id,
      i.tenant_id,
      i.status,
      i.amount_try,
      i.currency,
      i.meta
    into
      v_invoice_id,
      v_tenant_id,
      v_invoice_status,
      v_amount_try,
      v_invoice_currency,
      v_invoice_meta
    from public.invoices i
    where i.meta ->> 'conversationId' = v_conversation_id
    order by i.created_at desc, i.id desc
    limit 1
    for update;

    if not found then
      raise exception 'Billing invoice not found.' using errcode = 'P0002';
    end if;

    if v_invoice_status not in ('open', 'paid') then
      raise exception 'Invoice is not payable.' using errcode = '22023';
    end if;

    if upper(btrim(coalesce(v_invoice_currency, ''))) <> v_expected_currency then
      raise exception 'Invoice currency does not match.' using errcode = '22023';
    end if;

    v_plan := coalesce(nullif(btrim(v_invoice_meta ->> 'plan'), ''), 'office');
    v_cycle := coalesce(nullif(btrim(v_invoice_meta ->> 'cycle'), ''), 'monthly');

    if v_plan not in ('advisor', 'office', 'professional', 'enterprise')
      or v_cycle not in ('monthly', 'yearly') then
      raise exception 'Invoice billing metadata is invalid.' using errcode = '22023';
    end if;

    if p_expected_tenant_id is not null and p_expected_tenant_id is distinct from v_tenant_id then
      raise exception 'Invoice tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(p_expected_plan)) is distinct from v_plan then
      raise exception 'Invoice plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(p_expected_cycle)) is distinct from v_cycle then
      raise exception 'Invoice billing cycle does not match.' using errcode = '22023';
    end if;

    v_monthly_amount := case v_plan
      when 'advisor' then 990
      when 'office' then 2490
      when 'professional' then 5990
      when 'enterprise' then 12900
    end;

    if v_amount_try is null or v_amount_try <= 0 then
      v_amount_try := case
        when v_cycle = 'yearly' then round(v_monthly_amount * 12 * 0.8, 2)
        else v_monthly_amount
      end;
    end if;

    v_tax_try := round(v_amount_try * 0.20, 2);
    v_total_try := round(v_amount_try + v_tax_try, 2);

    if abs(v_total_try - p_expected_amount_try) > 0.01 then
      raise exception 'Invoice total does not match.' using errcode = '22023';
    end if;

    -- Legacy paid rows may predate the event table. Claim them without extending
    -- the subscription period a second time.
    if v_invoice_status = 'paid' then
      v_result := jsonb_build_object(
        'ok', true,
        'already', true,
        'targetType', 'subscription',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;

    v_period_end := case
      when v_cycle = 'yearly' then v_now + interval '1 year'
      else v_now + interval '1 month'
    end;
    insert into public.subscriptions (
      tenant_id,
      plan,
      status,
      billing_cycle,
      amount_try,
      current_period_start,
      current_period_end,
      trial_ends_at,
      cancelled_at,
      iyzico_subscription_ref,
      updated_at
    ) values (
      v_tenant_id,
      v_plan,
      'active',
      v_cycle,
      v_monthly_amount,
      v_now,
      v_period_end,
      null,
      null,
      coalesce(v_payment_id, v_conversation_id),
      v_now
    )
    on conflict (tenant_id) do update
    set
      plan = excluded.plan,
      status = 'active',
      billing_cycle = excluded.billing_cycle,
      amount_try = excluded.amount_try,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      trial_ends_at = null,
      cancelled_at = null,
      iyzico_subscription_ref = excluded.iyzico_subscription_ref,
      updated_at = v_now
    returning id into v_subscription_id;

    if v_subscription_id is null then
      raise exception 'Subscription could not be updated.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      subscription_id = v_subscription_id,
      status = 'paid',
      amount_try = v_amount_try,
      tax_try = v_tax_try,
      total_try = v_total_try,
      period_start = v_now,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      paid_at = coalesce(i.paid_at, v_now),
      iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
      meta = i.meta || jsonb_build_object(
        'conversationId', v_conversation_id,
        'plan', v_plan,
        'cycle', v_cycle,
        'source', v_source,
        'provider', v_provider
      )
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Invoice could not be updated.' using errcode = '55000';
    end if;

    update public.tenants t
    set plan = v_plan, status = 'active', updated_at = v_now
    where t.id = v_tenant_id
    returning t.id into v_updated_tenant_id;

    if v_updated_tenant_id is null then
      raise exception 'Tenant could not be updated.' using errcode = '55000';
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'already', false,
      'targetType', 'subscription',
      'tenantId', v_tenant_id::text,
      'invoiceId', v_invoice_id::text,
      'plan', v_plan,
      'cycle', v_cycle,
      'amountTry', v_total_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_tenant_id,
      invoice_id = v_invoice_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  v_link_token := substring(v_conversation_id from 7);
  if nullif(v_link_token, '') is null then
    raise exception 'Payment link identity is invalid.' using errcode = '22023';
  end if;

  select
    pl.id,
    pl.tenant_id,
    pl.commission_id,
    pl.status,
    pl.amount_try,
    pl.expires_at
  into
    v_payment_link_id,
    v_payment_link_tenant_id,
    v_payment_link_commission_id,
    v_payment_link_status,
    v_payment_link_amount_try,
    v_payment_link_expires_at
  from public.payment_links pl
  where pl.token = v_link_token
  for update;

  if not found then
    raise exception 'Payment link not found.' using errcode = 'P0002';
  end if;

  if v_payment_link_status not in ('open', 'paid') then
    raise exception 'Payment link is not payable.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'open'
    and v_payment_link_expires_at is not null
    and v_payment_link_expires_at <= v_now then
    raise exception 'Payment link has expired.' using errcode = '22023';
  end if;

  if p_expected_tenant_id is not null
    and p_expected_tenant_id is distinct from v_payment_link_tenant_id then
    raise exception 'Payment link tenant does not match.' using errcode = '22023';
  end if;

  if p_expected_plan is not null or p_expected_cycle is not null then
    raise exception 'Payment link does not accept subscription expectations.'
      using errcode = '22023';
  end if;

  if v_payment_link_amount_try is null
    or v_payment_link_amount_try <= 0
    or abs(v_payment_link_amount_try - p_expected_amount_try) > 0.01 then
    raise exception 'Payment link amount does not match.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'paid' then
    v_result := jsonb_build_object(
      'ok', true,
      'already', true,
      'targetType', 'payment_link',
      'tenantId', v_payment_link_tenant_id::text,
      'paymentLinkId', v_payment_link_id::text,
      'amountTry', v_payment_link_amount_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_payment_link_tenant_id,
      payment_link_id = v_payment_link_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  update public.payment_links pl
  set
    status = 'paid',
    paid_at = coalesce(pl.paid_at, v_now),
    meta = pl.meta || jsonb_build_object(
      'conversationId', v_conversation_id,
      'source', v_source,
      'provider', v_provider
    )
  where pl.id = v_payment_link_id
    and pl.tenant_id = v_payment_link_tenant_id
    and pl.status = 'open'
  returning pl.id into v_updated_payment_link_id;

  if v_updated_payment_link_id is null then
    raise exception 'Payment link could not be updated.' using errcode = '55000';
  end if;

  if v_payment_link_commission_id is not null then
    update public.commissions c
    set status = 'paid'
    where c.id = v_payment_link_commission_id
      and c.tenant_id = v_payment_link_tenant_id
      and c.status not in ('paid', 'collected')
    returning c.id into v_updated_commission_id;

    if v_updated_commission_id is not null then
      v_commission_changed := true;
    else
      perform 1
      from public.commissions c
      where c.id = v_payment_link_commission_id
        and c.tenant_id = v_payment_link_tenant_id
        and c.status in ('paid', 'collected');

      if not found then
        raise exception 'Payment link commission does not belong to tenant.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.notifications (
    tenant_id,
    title,
    body,
    href,
    kind,
    meta
  ) values (
    v_payment_link_tenant_id,
    'Ödeme linki tahsil edildi',
    case
      when v_source = 'demo' then 'Demo tahsilat tamamlandı.'
      else 'Kaparo / komisyon ödemesi alındı.'
    end,
    '/app/komisyon',
    'success',
    jsonb_build_object(
      'payment_link_id', v_payment_link_id,
      'fulfillment_event_id', v_event_id
    )
  )
  returning id into v_notification_id;

  if v_notification_id is null then
    raise exception 'Payment notification could not be created.' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'already', false,
    'targetType', 'payment_link',
    'tenantId', v_payment_link_tenant_id::text,
    'paymentLinkId', v_payment_link_id::text,
    'commissionUpdated', v_commission_changed,
    'amountTry', v_payment_link_amount_try,
    'currency', v_expected_currency
  );

  update public.billing_fulfillment_events
  set
    status = 'completed',
    tenant_id = v_payment_link_tenant_id,
    payment_link_id = v_payment_link_id,
    result = v_result,
    completed_at = v_now
  where id = v_event_id
  returning id into v_completed_event_id;

  if v_completed_event_id is null then
    raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
  end if;

  return v_result;
end;
$$;

revoke all privileges on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) to service_role;

comment on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) is
  'Service-role-only atomic fulfillment. Unique provider/conversation and provider/payment claims serialize callback/webhook races.';

-- ---------------------------------------------------------------------------
-- provision_registration (20260731000140 + K1 deneme gunu ifadesi)
-- ---------------------------------------------------------------------------
create or replace function public.provision_registration(
  p_user_id uuid,
  p_company text,
  p_slug_base text,
  p_full_name text,
  p_phone text,
  p_plan text,
  p_billing_cycle text,
  p_team_size text,
  p_terms_version text,
  p_kvkk_version text,
  p_ip_address text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_trial_ends timestamptz := v_now + make_interval(days => public.platform_default_trial_days());
  v_slug_base text;
  v_candidate_slug text;
  v_tenant_id uuid;
  v_tenant_slug text;
  v_profile_id uuid;
  v_subscription_id uuid;
  v_consent_id uuid;
  v_monthly_amount numeric;
  v_attempt integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_user_id
  ) then
    raise exception 'Pending auth user not found.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'User is already provisioned.' using errcode = '23505';
  end if;

  if char_length(btrim(coalesce(p_company, ''))) not between 2 and 160 then
    raise exception 'Invalid company.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 120 then
    raise exception 'Invalid full name.' using errcode = '22023';
  end if;
  if p_phone is not null and char_length(btrim(p_phone)) not between 1 and 32 then
    raise exception 'Invalid phone.' using errcode = '22023';
  end if;
  if p_plan not in ('advisor', 'office', 'professional', 'enterprise') then
    raise exception 'Invalid plan.' using errcode = '22023';
  end if;
  if p_billing_cycle not in ('monthly', 'yearly') then
    raise exception 'Invalid billing cycle.' using errcode = '22023';
  end if;
  if p_team_size not in ('1', '2-10', '10-50', '50+') then
    raise exception 'Invalid team size.' using errcode = '22023';
  end if;
  if p_terms_version is distinct from 'kullanim-sartlari-2026-07-31'
    or p_kvkk_version is distinct from 'kvkk-aydinlatma-2026-07-31' then
    raise exception 'Invalid consent version.' using errcode = '22023';
  end if;
  if p_ip_address is not null and char_length(btrim(p_ip_address)) not between 1 and 128 then
    raise exception 'Invalid audit IP.' using errcode = '22023';
  end if;
  if p_user_agent is not null and char_length(p_user_agent) not between 1 and 512 then
    raise exception 'Invalid user agent.' using errcode = '22023';
  end if;

  v_slug_base := lower(btrim(coalesce(p_slug_base, '')));
  if char_length(v_slug_base) not between 1 and 48
    or v_slug_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Invalid tenant slug.' using errcode = '22023';
  end if;

  v_monthly_amount := case p_plan
    when 'advisor' then 990
    when 'office' then 2490
    when 'professional' then 5990
    when 'enterprise' then 12900
  end;
  -- The unique slug decision is made inside the same transaction as the insert,
  -- avoiding the check-then-insert race in the former Server Action flow.
  for v_attempt in 0..7 loop
    v_candidate_slug := case
      when v_attempt = 0 then v_slug_base
      else v_slug_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    end;

    begin
      insert into public.tenants (
        name,
        slug,
        plan,
        status,
        trial_ends_at,
        team_size
      )
      values (
        btrim(p_company),
        v_candidate_slug,
        p_plan,
        'trial',
        v_trial_ends,
        p_team_size
      )
      returning id, slug into v_tenant_id, v_tenant_slug;
      exit;
    exception when unique_violation then
      if v_attempt = 7 then
        raise exception 'Tenant slug allocation failed.' using errcode = '23505';
      end if;
    end;
  end loop;

  if v_tenant_id is null then
    raise exception 'Tenant insert did not return an id.' using errcode = '55000';
  end if;

  insert into public.profiles (
    id,
    tenant_id,
    full_name,
    phone,
    role
  )
  values (
    p_user_id,
    v_tenant_id,
    btrim(p_full_name),
    nullif(btrim(p_phone), ''),
    'owner'
  )
  returning id into v_profile_id;

  insert into public.subscriptions (
    tenant_id,
    plan,
    status,
    billing_cycle,
    amount_try,
    currency,
    current_period_start,
    current_period_end,
    trial_ends_at
  )
  values (
    v_tenant_id,
    p_plan,
    'trialing',
    p_billing_cycle,
    -- subscriptions.amount_try is the canonical monthly/MRR amount. The
    -- selected cycle is stored separately; yearly checkout totals are derived
    -- by the billing contract when payment is initiated.
    v_monthly_amount,
    'TRY',
    v_now,
    v_trial_ends,
    v_trial_ends
  )
  returning id into v_subscription_id;

  insert into public.registration_consents (
    tenant_id,
    user_id,
    scope,
    terms_version,
    kvkk_version,
    accepted_at,
    ip_address,
    user_agent
  )
  values (
    v_tenant_id,
    p_user_id,
    'account_registration',
    p_terms_version,
    p_kvkk_version,
    v_now,
    nullif(btrim(p_ip_address), ''),
    nullif(p_user_agent, '')
  )
  returning id into v_consent_id;

  if v_profile_id is null or v_subscription_id is null or v_consent_id is null then
    raise exception 'Registration provisioning incomplete.' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'tenantId', v_tenant_id::text,
    'tenantSlug', v_tenant_slug,
    'plan', p_plan,
    'billingCycle', p_billing_cycle
  );
end;
$$;

revoke all privileges on function public.provision_registration(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.provision_registration(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

comment on function public.provision_registration(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) is
  'Service-role-only atomic registration provisioning with canonical plan pricing and versioned legal acceptance.';

-- ---------------------------------------------------------------------------
-- convert_demo_request_to_tenant (20260802000400 + K1 deneme gunu ifadesi)
-- ---------------------------------------------------------------------------
create or replace function public.convert_demo_request_to_tenant(
  p_demo_id uuid,
  p_owner_user_id uuid,
  p_actor_id uuid,
  p_slug_base text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_trial_ends timestamptz := v_now + make_interval(days => public.platform_default_trial_days());
  v_demo public.demo_requests%rowtype;
  v_previous_status text;
  v_email text;
  v_full_name text;
  v_phone text;
  v_company text;
  v_team_size text;
  v_plan text;
  v_monthly_amount numeric;
  v_slug_base text;
  v_candidate_slug text;
  v_tenant_id uuid;
  v_tenant_slug text;
  v_profile_id uuid;
  v_subscription_id uuid;
  v_updated_demo_id uuid;
  v_tenant_audit_id uuid;
  v_platform_audit_id uuid;
  v_auth_email text;
  v_auth_user_meta jsonb;
  v_auth_app_meta jsonb;
  v_attempt integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_actor_id is null or not exists (
    select 1
    from public.platform_staff ps
    where ps.id = p_actor_id
      and ps.is_active = true
      and ps.role in ('super_admin', 'ops', 'support')
  ) then
    raise exception 'Active sales staff required.' using errcode = '42501';
  end if;

  if p_demo_id is null or p_owner_user_id is null then
    raise exception 'Demo and pending owner are required.' using errcode = '22023';
  end if;

  select d.*
    into v_demo
  from public.demo_requests d
  where d.id = p_demo_id
  for update;

  if not found then
    raise exception 'Demo request not found.' using errcode = 'P0002';
  end if;
  if v_demo.converted_tenant_id is not null then
    raise exception 'Demo request is already converted.' using errcode = '23505';
  end if;

  v_previous_status := v_demo.status;
  v_email := lower(btrim(coalesce(v_demo.email, '')));
  v_full_name := btrim(coalesce(v_demo.full_name, ''));
  v_phone := btrim(coalesce(v_demo.phone, ''));
  v_company := coalesce(
    nullif(btrim(coalesce(v_demo.company, '')), ''),
    v_full_name || ' Emlak'
  );

  if char_length(v_email) not between 3 and 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Valid demo email required.' using errcode = '22023';
  end if;
  if char_length(v_full_name) not between 2 and 120 then
    raise exception 'Invalid demo full name.' using errcode = '22023';
  end if;
  if char_length(v_company) not between 2 and 160 then
    raise exception 'Invalid demo company.' using errcode = '22023';
  end if;
  if v_phone <> '' and char_length(v_phone) not between 1 and 32 then
    raise exception 'Invalid demo phone.' using errcode = '22023';
  end if;

  v_team_size := case btrim(coalesce(v_demo.team_size, ''))
    when '1' then '1'
    when '50+' then '50+'
    when '50plus' then '50+'
    when '10-50' then '10-50'
    when '11-50' then '10-50'
    else '2-10'
  end;
  v_plan := case v_team_size
    when '1' then 'advisor'
    when '10-50' then 'professional'
    when '50+' then 'enterprise'
    else 'office'
  end;
  v_monthly_amount := case v_plan
    when 'advisor' then 990
    when 'office' then 2490
    when 'professional' then 5990
    when 'enterprise' then 12900
  end;

  v_slug_base := lower(btrim(coalesce(p_slug_base, '')));
  if char_length(v_slug_base) not between 1 and 48
    or v_slug_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Invalid tenant slug.' using errcode = '22023';
  end if;

  select
    lower(btrim(coalesce(u.email, ''))),
    coalesce(u.raw_user_meta_data, '{}'::jsonb),
    coalesce(u.raw_app_meta_data, '{}'::jsonb)
    into v_auth_email, v_auth_user_meta, v_auth_app_meta
  from auth.users u
  where u.id = p_owner_user_id
  for update;

  if not found then
    raise exception 'Pending Auth owner not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_owner_user_id)
    or exists (select 1 from public.platform_staff ps where ps.id = p_owner_user_id)
    or nullif(btrim(v_auth_app_meta ->> 'tenant_id'), '') is not null then
    raise exception 'Auth owner is already provisioned.' using errcode = '23505';
  end if;
  if v_auth_email is distinct from v_email
    or btrim(coalesce(v_auth_user_meta ->> 'full_name', '')) is distinct from v_full_name
    or btrim(coalesce(v_auth_user_meta ->> 'phone', '')) is distinct from v_phone
    or v_auth_app_meta ->> 'role' is distinct from 'owner'
    or v_auth_app_meta ->> 'account_active' is distinct from 'true' then
    raise exception 'Pending Auth owner identity mismatch.' using errcode = '22023';
  end if;

  -- Slug allocation and insert share this transaction, eliminating the former
  -- check-then-insert race between parallel conversions.
  for v_attempt in 0..7 loop
    v_candidate_slug := case
      when v_attempt = 0 then v_slug_base
      else v_slug_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    end;

    begin
      insert into public.tenants (
        name,
        slug,
        plan,
        status,
        trial_ends_at,
        team_size
      ) values (
        v_company,
        v_candidate_slug,
        v_plan,
        'trial',
        v_trial_ends,
        v_team_size
      )
      returning id, slug into v_tenant_id, v_tenant_slug;
      exit;
    exception when unique_violation then
      if v_attempt = 7 then
        raise exception 'Tenant slug allocation failed.' using errcode = '23505';
      end if;
    end;
  end loop;

  if v_tenant_id is null then
    raise exception 'Tenant insert did not return an id.' using errcode = '55000';
  end if;

  insert into public.profiles (
    id,
    tenant_id,
    full_name,
    phone,
    role
  ) values (
    p_owner_user_id,
    v_tenant_id,
    v_full_name,
    nullif(v_phone, ''),
    'owner'
  )
  returning id into v_profile_id;

  -- The profile insert trigger is the canonical Auth claim synchronizer. Its
  -- result is verified before any conversion can commit.
  select coalesce(u.raw_app_meta_data, '{}'::jsonb)
    into v_auth_app_meta
  from auth.users u
  where u.id = p_owner_user_id;

  if nullif(btrim(v_auth_app_meta ->> 'tenant_id'), '') is distinct from v_tenant_id::text
    or v_auth_app_meta ->> 'role' is distinct from 'owner'
    or v_auth_app_meta ->> 'account_active' is distinct from 'true' then
    raise exception 'Owner Auth identity synchronization failed.' using errcode = '55000';
  end if;

  insert into public.subscriptions (
    tenant_id,
    plan,
    status,
    billing_cycle,
    amount_try,
    currency,
    current_period_start,
    current_period_end,
    trial_ends_at
  ) values (
    v_tenant_id,
    v_plan,
    'trialing',
    'monthly',
    v_monthly_amount,
    'TRY',
    v_now,
    v_trial_ends,
    v_trial_ends
  )
  returning id into v_subscription_id;

  update public.demo_requests
  set status = 'won',
      converted_tenant_id = v_tenant_id,
      updated_at = v_now
  where id = p_demo_id
    and converted_tenant_id is null
  returning id into v_updated_demo_id;

  if v_updated_demo_id is null then
    raise exception 'Demo conversion guard failed.' using errcode = '40001';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    v_tenant_id,
    p_actor_id,
    'sales.convert',
    'demo',
    p_demo_id,
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object(
      'status', 'won',
      'tenant_id', v_tenant_id,
      'tenant_slug', v_tenant_slug,
      'owner_user_id', p_owner_user_id,
      'plan', v_plan,
      'monthly_amount_try', v_monthly_amount
    )
  )
  returning id into v_tenant_audit_id;

  insert into public.platform_audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    meta
  ) values (
    p_actor_id,
    'sales.convert',
    'demo',
    p_demo_id,
    jsonb_build_object(
      'tenant_id', v_tenant_id,
      'tenant_slug', v_tenant_slug,
      'owner_user_id', p_owner_user_id,
      'plan', v_plan,
      'monthly_amount_try', v_monthly_amount
    )
  )
  returning id into v_platform_audit_id;

  if v_profile_id is null
    or v_subscription_id is null
    or v_tenant_audit_id is null
    or v_platform_audit_id is null then
    raise exception 'Demo conversion provisioning incomplete.' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'tenantId', v_tenant_id::text,
    'tenantSlug', v_tenant_slug,
    'tenantName', v_company,
    'plan', v_plan,
    'email', v_email,
    'ownerUserId', p_owner_user_id::text
  );
end;
$$;

revoke all privileges on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)
  to service_role;

comment on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text) is
  'Service-role-only atomic demo conversion with locked idempotency guard, canonical trial subscription, Auth claim verification and dual audit evidence.';

-- ---------------------------------------------------------------------------
-- Yardimcilar (geri donulen govdeler bunlari cagirmaz)
-- ---------------------------------------------------------------------------
drop function if exists public.plan_campaign_lock_amount(text);
drop function if exists public.plan_period_amount(text, text);
drop function if exists public.plan_yearly_paid_months(text);
drop function if exists public.plan_monthly_amount(text);
drop function if exists public.plan_catalog_document();

notify pgrst, 'reload schema';
