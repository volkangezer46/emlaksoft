-- Rollback: 20261005000900_seat_purchase_fulfillment (TASLAK; proposed dosyasiyla birlikte terfi eder)
-- Onceki govdelere AYNEN doner (kaynak dosyalardan birebir kopya, yazim aninda uretildi):
--   enforce_plan_capacity()            <- supabase/migrations/20260802000320_plan_entitlements.sql
--   enforce_tenant_plan_capacity()     <- supabase/migrations/20260802000320_plan_entitlements.sql
--   fulfill_billing_payment (10 arg)   <- supabase/proposed/20261005000500_billing_plan_amount_integrity.sql
--   fulfill_billing_payment_v2         <- supabase/migrations/20260810000100_billing_checkout_reconciliation.sql
--   seat_purchase_ready()              <- kaldirilir (kod satisi kapatir; gosterim extra_seats + effective_seat_limit
--                                         oldukca surer)
-- SIRA: bu rollback 20261005000500 ve 20261005000800 rollback'lerinden ONCE calistirilir.
-- UYARI: geri alininca koltuk tetikleyicileri yine YALNIZ plan limitini uygular. Satin alinmis extra_seats
-- DEGERLERI silinmez (veri degisikligi yapilmaz) ama yeni kullanici aktivasyonunda sayilmaz: ek koltuk odemis
-- ofis plan limitinin ustunde kullanici ekleyemez (mevcut aktif kullanicilar pasife alinmaz). Ilerleyen bir
-- extra_seats faturasi (iyzico'da odenmis, henuz islenmemis) bu durumda plan yenilemesi gibi ISLENIR
-- (donem uzar); rollback oncesi `billing_payment_captures` icinde captured_pending/retry_pending koltuk
-- tahsilati kalmadigini dogrulayin:
--   select c.id, c.conversation_id, c.status from public.billing_payment_captures c
--   join public.invoices i on i.meta ->> 'conversationId' = c.conversation_id
--   where i.meta ->> 'kind' = 'extra_seats' and c.status in ('captured_pending', 'retry_pending', 'manual_review');
-- Yalniz restore edilebilir backup/PITR dogrulandiktan sonra sahibi uygular.

-- Once hazirlik sondasi kaldirilir: kod (getSeatSupport, 60 sn onbellek) satisi hemen kapatir.
drop function if exists public.seat_purchase_ready();

-- ---------------------------------------------------------------------------
-- 1. enforce_plan_capacity (20260802000320 aynen)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant uuid;
  metric text;
  capacity integer;
  current_usage bigint;
  should_check boolean := false;
begin
  target_tenant := new.tenant_id;

  case tg_table_name
    when 'profiles' then
      metric := 'seats';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    when 'customers' then
      metric := 'customers';
      should_check := new.deleted_at is null and (
        tg_op = 'INSERT' or old.deleted_at is not null or new.tenant_id is distinct from old.tenant_id
      );
    when 'properties' then
      metric := 'active_properties';
      should_check := new.deleted_at is null
        and new.status in ('draft', 'live', 'reserved')
        and (
          tg_op = 'INSERT'
          or old.deleted_at is not null
          or old.status not in ('draft', 'live', 'reserved')
          or new.tenant_id is distinct from old.tenant_id
      );
    when 'branches' then
      metric := 'branches';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    else
      return new;
  end case;

  if not should_check then
    return new;
  end if;

  -- Serialize every capacity-changing operation for the tenant. A tenant-wide
  -- lock also makes concurrent plan downgrades and inserts observe one another.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || target_tenant::text, 0)
  );

  select case metric
    when 'seats' then pe.seat_limit
    when 'customers' then pe.customer_limit
    when 'active_properties' then pe.active_property_limit
    when 'branches' then pe.branch_limit
  end
  into capacity
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  where t.id = target_tenant;

  if capacity is null then
    return new;
  end if;

  case metric
    when 'seats' then
      select count(*) into current_usage from public.profiles
      where tenant_id = target_tenant and is_active = true;
    when 'customers' then
      select count(*) into current_usage from public.customers
      where tenant_id = target_tenant and deleted_at is null;
    when 'active_properties' then
      select count(*) into current_usage from public.properties
      where tenant_id = target_tenant
        and deleted_at is null
        and status in ('draft', 'live', 'reserved');
    when 'branches' then
      select count(*) into current_usage from public.branches
      where tenant_id = target_tenant and is_active = true;
  end case;

  if current_usage >= capacity then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_LIMIT_EXCEEDED:' || metric || ':' || capacity::text;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_capacity() from public, anon, authenticated;
comment on function public.enforce_plan_capacity() is null;

-- ---------------------------------------------------------------------------
-- 2. enforce_tenant_plan_capacity (20260802000320 aynen)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_tenant_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits record;
  current_usage bigint;
begin
  if new.plan is not distinct from old.plan then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || new.id::text, 0)
  );

  select
    pe.seat_limit,
    pe.customer_limit,
    pe.active_property_limit,
    pe.branch_limit
  into limits
  from public.plan_entitlements pe
  where pe.plan = new.plan;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_ENTITLEMENT_NOT_FOUND:' || new.plan;
  end if;

  if limits.seat_limit is not null then
    select count(*) into current_usage
    from public.profiles
    where tenant_id = new.id and is_active = true;
    if current_usage > limits.seat_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:seats:' || limits.seat_limit::text;
    end if;
  end if;

  if limits.customer_limit is not null then
    select count(*) into current_usage
    from public.customers
    where tenant_id = new.id and deleted_at is null;
    if current_usage > limits.customer_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:customers:' || limits.customer_limit::text;
    end if;
  end if;

  if limits.active_property_limit is not null then
    select count(*) into current_usage
    from public.properties
    where tenant_id = new.id
      and deleted_at is null
      and status in ('draft', 'live', 'reserved');
    if current_usage > limits.active_property_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:active_properties:' || limits.active_property_limit::text;
    end if;
  end if;

  if limits.branch_limit is not null then
    select count(*) into current_usage
    from public.branches
    where tenant_id = new.id and is_active = true;
    if current_usage > limits.branch_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:branches:' || limits.branch_limit::text;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_tenant_plan_capacity() from public, anon, authenticated;
comment on function public.enforce_tenant_plan_capacity() is null;

-- ---------------------------------------------------------------------------
-- 3. fulfill_billing_payment, 10 arg (20261005000500 aynen)
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

  v_sub_plan text;
  v_old_lock_try numeric;
  v_old_lock_campaign text;
  v_meta_lock_try numeric;
  v_meta_lock_campaign text;
  v_lock_try numeric;
  v_lock_campaign text;
  v_subscription_amount numeric;

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

    if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise')
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

    -- Aylik liste fiyati plan tanimindan (platform katalogu; ayar yoksa onayli katalog).
    v_monthly_amount := public.plan_monthly_amount(v_plan);
    if v_monthly_amount is null or v_monthly_amount <= 0 then
      raise exception 'Plan amount could not be resolved.' using errcode = '22023';
    end if;

    -- Fatura tutari yoksa yedek: donem tutari (yillik = aylik * yillik odenen ay; 0.8 carpani yok).
    if v_amount_try is null or v_amount_try <= 0 then
      v_amount_try := public.plan_period_amount(v_plan, v_cycle);
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

    -- Fiyat kilidi (Founders). Kaynak sirasi: (1) sunucunun faturaya yazdigi teklif kilidi,
    -- (2) ayni planda mevcut kilit korunur, (3) plan degisiminde Founders uyesi yeni planin kampanya
    -- fiyatina yeniden kilitlenir (yoksa kilit kalkar).
    if v_invoice_meta ? 'priceLockTry' or v_invoice_meta ? 'priceLockCampaign' then
      if jsonb_typeof(v_invoice_meta -> 'priceLockTry') is distinct from 'number'
        or char_length(btrim(coalesce(v_invoice_meta ->> 'priceLockCampaign', ''))) not between 1 and 60 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
      v_meta_lock_try := (v_invoice_meta ->> 'priceLockTry')::numeric;
      v_meta_lock_campaign := btrim(v_invoice_meta ->> 'priceLockCampaign');
      if v_meta_lock_try <= 0 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
    end if;

    select s.plan, s.price_lock_try, s.price_lock_campaign
      into v_sub_plan, v_old_lock_try, v_old_lock_campaign
    from public.subscriptions s
    where s.tenant_id = v_tenant_id
    for update;

    if v_meta_lock_try is not null and v_meta_lock_try < v_monthly_amount then
      v_lock_try := v_meta_lock_try;
      v_lock_campaign := v_meta_lock_campaign;
    elsif v_old_lock_try is not null and v_sub_plan is not distinct from v_plan then
      v_lock_try := v_old_lock_try;
      v_lock_campaign := v_old_lock_campaign;
    elsif v_old_lock_campaign is not null and v_sub_plan is distinct from v_plan then
      v_lock_try := public.plan_campaign_lock_amount(v_plan);
      v_lock_campaign := case when v_lock_try is not null then v_old_lock_campaign end;
    end if;

    -- subscriptions.amount_try kanonik aylik (MRR) tutardir; kilit varsa kilitli fiyat.
    v_subscription_amount := case
      when v_lock_try is not null then least(v_lock_try, v_monthly_amount)
      else v_monthly_amount
    end;

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
      price_lock_try,
      price_lock_campaign,
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
      v_subscription_amount,
      v_lock_try,
      v_lock_campaign,
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
      price_lock_try = excluded.price_lock_try,
      price_lock_campaign = excluded.price_lock_campaign,
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
-- 4. fulfill_billing_payment_v2 (20260810000100 aynen)
-- ---------------------------------------------------------------------------
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
comment on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) is null;

notify pgrst, 'reload schema';
