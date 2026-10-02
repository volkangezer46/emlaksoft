-- Pricing -> registration -> subscription contract.
-- A service-role-only RPC creates the tenant, owner profile, trial subscription
-- and versioned legal acceptance in one transaction. No partial business tenant
-- remains when any critical insert fails.

alter table public.tenants
  add column if not exists team_size text;

alter table public.tenants
  drop constraint if exists tenants_team_size_check,
  add constraint tenants_team_size_check check (
    team_size is null or team_size in ('1', '2-10', '10-50', '50+')
  );

comment on column public.tenants.team_size is
  'Registration-time team-size band used for onboarding personalization; it does not override the explicitly selected plan.';

create table if not exists public.registration_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'account_registration'
    check (scope = 'account_registration'),
  terms_version text not null
    check (char_length(btrim(terms_version)) between 1 and 80),
  kvkk_version text not null
    check (char_length(btrim(kvkk_version)) between 1 and 80),
  accepted_at timestamptz not null default now(),
  ip_address text
    check (ip_address is null or char_length(ip_address) between 1 and 128),
  user_agent text
    check (user_agent is null or char_length(user_agent) between 1 and 512),
  unique (user_id, terms_version, kvkk_version)
);

create index if not exists idx_registration_consents_tenant_accepted
  on public.registration_consents(tenant_id, accepted_at desc);

alter table public.registration_consents enable row level security;
revoke all privileges on table public.registration_consents
  from public, anon, authenticated;
grant all privileges on table public.registration_consents
  to service_role;

comment on table public.registration_consents is
  'Service-role-only evidence of the exact terms and KVKK notice acknowledged during account registration.';
comment on column public.registration_consents.accepted_at is
  'Server/database timestamp; never accepted from the browser.';

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
  v_trial_ends timestamptz := v_now + interval '14 days';
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

notify pgrst, 'reload schema';
