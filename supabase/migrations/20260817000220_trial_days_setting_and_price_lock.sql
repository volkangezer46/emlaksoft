-- K2: Deneme günü ayardan okunur + Founders kilitli fiyat (forward-only).
-- billing_trial_days(): platform_settings 'billing.plan_definitions' JSON'undaki trialDays (1-90), yoksa 14.
-- provision_registration ve convert_demo_request_to_tenant sabit 14 gün ifadesi yerine bunu kullanır.

create or replace function public.billing_trial_days()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_days integer;
begin
  select value into v_raw from public.platform_settings where key = 'billing.plan_definitions';
  begin
    v_days := (v_raw::jsonb ->> 'trialDays')::integer;
  exception when others then
    v_days := null;
  end;
  if v_days is null or v_days < 1 or v_days > 90 then
    return 14;
  end if;
  return v_days;
end;
$$;

revoke all privileges on function public.billing_trial_days() from public, anon, authenticated;
grant execute on function public.billing_trial_days() to service_role;

alter table public.subscriptions
  add column if not exists price_lock_try numeric
    check (price_lock_try is null or price_lock_try > 0),
  add column if not exists price_lock_campaign text;

create index if not exists idx_subscriptions_price_lock_campaign
  on public.subscriptions (price_lock_campaign)
  where price_lock_campaign is not null;

comment on column public.subscriptions.price_lock_try is
  'Kampanya (Founders) aylık fiyatı; abonelik sürdükçe korunur. Null = liste fiyatı.';

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
  v_trial_ends timestamptz := v_now + make_interval(days => public.billing_trial_days());
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
  if p_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise') then
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
    when 'business' then 8990
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

revoke all privileges on function public.provision_registration(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.provision_registration(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

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
  v_trial_ends timestamptz := v_now + make_interval(days => public.billing_trial_days());
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

revoke all privileges on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
