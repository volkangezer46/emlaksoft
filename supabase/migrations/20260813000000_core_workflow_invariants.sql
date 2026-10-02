-- Core CRM workflow invariants
--
-- Business transitions that touch more than one row must have one database
-- commit point.  These RPCs are deliberately service-role-only: Server
-- Actions authenticate/authorize the actor, while the functions re-derive
-- ownership, lock the live rows and apply one single-winner transition.

-- The runner executes each migration in one transaction. Acquire every
-- reconciliation-ledger lock before the first index/function/repair/read so a
-- late RowExclusive application write cannot slip between the preflight and
-- the guards/revokes below. AccessShare reporting reads remain available.
-- Keep this order stable; the maintenance runbook drains writers first.
lock table
  public.commissions,
  public.customers,
  public.deals,
  public.offer_rounds,
  public.offers,
  public.project_units,
  public.properties,
  public.rentals
in share row exclusive mode;

create unique index if not exists uq_rentals_tenant_deal
  on public.rentals (tenant_id, deal_id)
  where deal_id is not null;

create unique index if not exists uq_deals_tenant_project_unit
  on public.deals (tenant_id, project_unit_id)
  where project_unit_id is not null;

-- ---------------------------------------------------------------------------
-- Contracts: signer creation + sent state, signer + aggregate signed state,
-- and cancellation/token invalidation are indivisible.
-- ---------------------------------------------------------------------------
create or replace function public.send_contract_for_signing_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_contract_id uuid,
  p_signers jsonb,
  p_default_expiry timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_signers jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_contract_id is null
     or jsonb_typeof(p_signers) is distinct from 'array'
     or jsonb_array_length(p_signers) not between 1 and 20
     or p_default_expiry is null or p_default_expiry <= v_now
     or p_default_expiry > v_now + interval '1 year' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_signers) s
    where char_length(btrim(coalesce(s ->> 'full_name', ''))) not between 1 and 160
       or char_length(btrim(coalesce(s ->> 'email', ''))) > 320
       or char_length(btrim(coalesce(s ->> 'phone', ''))) > 32
  ) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select c.* into v_contract
  from public.contracts c
  where c.id = p_contract_id and c.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_contract.status <> 'draft'::public.contract_status then
    return jsonb_build_object('outcome', 'invalid_state', 'current_status', v_contract.status);
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at <= v_now then
    return jsonb_build_object('outcome', 'expired');
  end if;

  with inserted as (
    insert into public.contract_signers (contract_id, full_name, email, phone, status)
    select
      p_contract_id,
      btrim(s ->> 'full_name'),
      nullif(btrim(coalesce(s ->> 'email', '')), ''),
      nullif(btrim(coalesce(s ->> 'phone', '')), ''),
      'pending'::public.signer_status
    from jsonb_array_elements(p_signers) with ordinality rows(s, n)
    order by n
    returning token, phone, full_name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('token', token, 'phone', phone, 'full_name', full_name)
      order by full_name, token
    ),
    '[]'::jsonb
  ) into v_signers
  from inserted;

  update public.contracts
  set status = 'sent'::public.contract_status,
      expires_at = coalesce(v_contract.expires_at, p_default_expiry),
      updated_at = v_now
  where id = p_contract_id and tenant_id = p_tenant_id
    and status = 'draft'::public.contract_status;
  if not found then
    raise exception 'Contract state changed while sending.' using errcode = '40001';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'contract.sent', 'contract', p_contract_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object(
      'status', 'sent',
      'signer_count', jsonb_array_length(v_signers),
      'expires_at', coalesce(v_contract.expires_at, p_default_expiry)
    )
  );

  return jsonb_build_object('outcome', 'applied', 'signers', v_signers);
end;
$$;

revoke all on function public.send_contract_for_signing_atomic(
  uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.send_contract_for_signing_atomic(
  uuid, uuid, uuid, jsonb, timestamptz
) to service_role;

create or replace function public.sign_contract_atomic(
  p_token text,
  p_ip text default null,
  p_require_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_signer public.contract_signers%rowtype;
  v_contract public.contracts%rowtype;
  v_tenant_status text;
  v_now timestamptz := clock_timestamp();
  v_pending integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_token, ''))) not between 16 and 256
     or char_length(coalesce(p_ip, '')) > 128 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select cs.*
    into v_signer
  from public.contract_signers cs
  inner join public.contracts c on c.id = cs.contract_id
  inner join public.tenants t on t.id = c.tenant_id
  where cs.token = btrim(p_token)
  for update of c, cs;
  if found then
    -- %rowtype değişkenler çok öğeli INTO listesinde kullanılamaz; satırlar kilitliyken ayrı okunur.
    select c.* into v_contract from public.contracts c where c.id = v_signer.contract_id;
    select t.status::text into v_tenant_status from public.tenants t where t.id = v_contract.tenant_id;
  end if;
  if not found then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;
  if v_tenant_status not in ('trial', 'active', 'past_due') then
    return jsonb_build_object('outcome', 'inactive_tenant');
  end if;
  if v_signer.status = 'signed'::public.signer_status then
    return jsonb_build_object(
      'outcome', 'replay', 'contract_id', v_signer.contract_id,
      'contract_status', v_contract.status
    );
  end if;
  if v_signer.status <> 'pending'::public.signer_status
     or v_contract.status <> 'sent'::public.contract_status then
    return jsonb_build_object(
      'outcome', 'invalid_state', 'signer_status', v_signer.status,
      'contract_status', v_contract.status
    );
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at < v_now then
    return jsonb_build_object('outcome', 'expired');
  end if;
  if coalesce(p_require_verified, false) and v_signer.verified_at is null then
    return jsonb_build_object('outcome', 'verification_required');
  end if;

  update public.contract_signers
  set status = 'signed'::public.signer_status,
      signed_at = v_now,
      ip_address = nullif(btrim(coalesce(p_ip, '')), ''),
      otp_hash = null,
      otp_expires_at = null,
      otp_attempts = 0
  where id = v_signer.id and status = 'pending'::public.signer_status;
  if not found then
    raise exception 'Signer state changed while signing.' using errcode = '40001';
  end if;

  select count(*)::integer into v_pending
  from public.contract_signers cs
  where cs.contract_id = v_signer.contract_id
    and cs.status = 'pending'::public.signer_status;

  if v_pending = 0 then
    update public.contracts
    set status = 'signed'::public.contract_status,
        signed_at = v_now,
        updated_at = v_now
    where id = v_signer.contract_id
      and status = 'sent'::public.contract_status;
    if not found then
      raise exception 'Contract state changed while signing.' using errcode = '40001';
    end if;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value, ip
  ) values (
    v_contract.tenant_id, null, 'contract.sign', 'contract_signer', v_signer.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', 'signed', 'contract_id', v_signer.contract_id,
      'contract_completed', v_pending = 0
    ),
    nullif(btrim(coalesce(p_ip, '')), '')
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'contract_id', v_signer.contract_id,
    'contract_status', case when v_pending = 0 then 'signed' else 'sent' end
  );
end;
$$;

revoke all on function public.sign_contract_atomic(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.sign_contract_atomic(text, text, boolean)
  to service_role;

create or replace function public.cancel_contract_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_contract_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_contract_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select c.* into v_contract
  from public.contracts c
  where c.id = p_contract_id and c.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_contract.status = 'cancelled'::public.contract_status then
    return jsonb_build_object('outcome', 'replay');
  end if;
  if v_contract.status not in (
    'draft'::public.contract_status,
    'sent'::public.contract_status
  ) then
    return jsonb_build_object('outcome', 'invalid_state', 'current_status', v_contract.status);
  end if;

  update public.contract_signers
  set status = 'rejected'::public.signer_status,
      otp_hash = null,
      otp_expires_at = null,
      otp_attempts = 0
  where contract_id = p_contract_id and status = 'pending'::public.signer_status;

  update public.contracts
  set status = 'cancelled'::public.contract_status,
      cancelled_at = v_now,
      updated_at = v_now
  where id = p_contract_id and tenant_id = p_tenant_id
    and status = v_contract.status;
  if not found then
    raise exception 'Contract state changed while cancelling.' using errcode = '40001';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'contract.cancel', 'contract', p_contract_id,
    jsonb_build_object('status', v_contract.status),
    jsonb_build_object('status', 'cancelled')
  );
  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke all on function public.cancel_contract_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_contract_atomic(uuid, uuid, uuid)
to service_role;

create or replace function public.update_contract_draft_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_contract_id uuid,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_title text;
  v_body text;
  v_version integer;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_contract_id is null
     or p_body is null or char_length(p_body) > 200000
     or (p_title is not null and char_length(btrim(p_title)) not between 1 and 500) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select c.* into v_contract
  from public.contracts c
  where c.id = p_contract_id and c.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_contract.status <> 'draft'::public.contract_status then
    return jsonb_build_object('outcome', 'invalid_state', 'current_status', v_contract.status);
  end if;

  v_title := coalesce(btrim(p_title), v_contract.title);
  v_body := p_body;
  if v_title is not distinct from v_contract.title
     and v_body is not distinct from v_contract.body then
    return jsonb_build_object('outcome', 'replay');
  end if;

  if v_body is distinct from v_contract.body
     and nullif(btrim(coalesce(v_contract.body, '')), '') is not null then
    select coalesce(max(cv.version_no), 0) + 1 into v_version
    from public.contract_versions cv
    where cv.contract_id = p_contract_id;
    insert into public.contract_versions (
      contract_id, version_no, content, saved_by
    ) values (
      p_contract_id, v_version, v_contract.body, p_actor_id
    );
  end if;

  update public.contracts
  set title = v_title, body = v_body, updated_at = v_now
  where id = p_contract_id and tenant_id = p_tenant_id
    and status = 'draft'::public.contract_status;
  if not found then
    raise exception 'Contract state changed while editing.' using errcode = '40001';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'contract.update', 'contract', p_contract_id,
    jsonb_build_object('title', v_contract.title),
    jsonb_build_object('title', v_title, 'version_created', v_version is not null)
  );
  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke all on function public.update_contract_draft_atomic(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.update_contract_draft_atomic(
  uuid, uuid, uuid, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Offers: the canonical offer and its negotiation round move together.  A row
-- lock makes next round numbering and terminal-state checks race-free.
-- ---------------------------------------------------------------------------
create or replace function public.create_offer_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_property_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_valid_until date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_property_id is null
     or p_amount is null or p_amount < 0.01 or p_amount > 100000000000
     or round(p_amount, 2) <> p_amount
     or char_length(coalesce(p_notes, '')) > 5000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not exists (
    select 1 from public.properties p
    where p.id = p_property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
  ) then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id and c.deleted_at is null
  ) then
    return jsonb_build_object('outcome', 'customer_not_found');
  end if;

  insert into public.offers (
    tenant_id, property_id, customer_id, created_by, amount, valid_until,
    notes, status, submitted_at
  ) values (
    p_tenant_id, p_property_id, p_customer_id, p_actor_id, p_amount,
    p_valid_until, nullif(btrim(coalesce(p_notes, '')), ''),
    'submitted'::public.offer_status, clock_timestamp()
  ) returning id into v_offer_id;

  insert into public.offer_rounds (
    tenant_id, offer_id, round_no, side, amount, note, created_by
  ) values (
    p_tenant_id, v_offer_id, 1, 'buyer', p_amount,
    nullif(btrim(coalesce(p_notes, '')), ''), p_actor_id
  );

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    p_tenant_id, p_actor_id, 'offer.create', 'offer', v_offer_id,
    jsonb_build_object('status', 'submitted', 'amount', p_amount)
  );
  return jsonb_build_object('outcome', 'created', 'offer_id', v_offer_id);
end;
$$;

revoke all on function public.create_offer_atomic(
  uuid, uuid, uuid, uuid, numeric, date, text
) from public, anon, authenticated;
grant execute on function public.create_offer_atomic(
  uuid, uuid, uuid, uuid, numeric, date, text
) to service_role;

create or replace function public.transition_offer_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_offer_id uuid,
  p_status text,
  p_counter_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.offers%rowtype;
  v_target text := lower(btrim(coalesce(p_status, '')));
  v_round integer;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_offer_id is null
     or v_target not in ('countered', 'accepted', 'rejected', 'withdrawn') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if v_target = 'countered'
     and (p_counter_amount is null or p_counter_amount < 0.01 or p_counter_amount > 100000000000
          or round(p_counter_amount, 2) <> p_counter_amount) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select o.* into v_offer
  from public.offers o
  where o.id = p_offer_id and o.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_offer.status::text = v_target then
    return jsonb_build_object('outcome', 'replay', 'current_status', v_target);
  end if;
  if v_offer.status::text not in ('submitted', 'countered') then
    return jsonb_build_object(
      'outcome', 'invalid_transition', 'current_status', v_offer.status,
      'requested_status', v_target
    );
  end if;
  if v_target in ('accepted', 'countered')
     and v_offer.valid_until is not null and v_offer.valid_until < current_date then
    return jsonb_build_object('outcome', 'expired');
  end if;

  update public.offers
  set status = v_target::public.offer_status,
      amount = case
        when v_target = 'accepted' and v_offer.status::text = 'countered'
          and v_offer.counter_amount is not null then v_offer.counter_amount
        else v_offer.amount
      end,
      counter_amount = case
        when v_target = 'countered' then p_counter_amount
        when v_target = 'accepted' and v_offer.status::text = 'countered'
          then v_offer.counter_amount
        else null
      end,
      responded_at = v_now,
      updated_at = v_now
  where id = p_offer_id and tenant_id = p_tenant_id and status = v_offer.status;
  if not found then
    raise exception 'Offer state changed while transitioning.' using errcode = '40001';
  end if;

  if v_target = 'countered' then
    select coalesce(max(r.round_no), 0) + 1 into v_round
    from public.offer_rounds r
    where r.offer_id = p_offer_id;
    insert into public.offer_rounds (
      tenant_id, offer_id, round_no, side, amount, created_by
    ) values (
      p_tenant_id, p_offer_id, v_round, 'seller', p_counter_amount, p_actor_id
    );
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'offer.transition', 'offer', p_offer_id,
    jsonb_build_object('status', v_offer.status),
    jsonb_build_object(
      'status', v_target,
      'accepted_amount', case
        when v_target = 'accepted' and v_offer.status::text = 'countered'
          then v_offer.counter_amount
        when v_target = 'accepted' then v_offer.amount else null end,
      'counter_amount', case
        when v_target = 'countered' then p_counter_amount else v_offer.counter_amount end
    )
  );
  return jsonb_build_object('outcome', 'applied', 'current_status', v_target);
end;
$$;

revoke all on function public.transition_offer_atomic(uuid, uuid, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.transition_offer_atomic(uuid, uuid, uuid, text, numeric)
  to service_role;

create or replace function public.add_offer_round_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_offer_id uuid,
  p_side text,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.offers%rowtype;
  v_side text := lower(btrim(coalesce(p_side, '')));
  v_round integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_offer_id is null
     or v_side not in ('buyer', 'seller')
     or p_amount is null or p_amount < 0.01 or p_amount > 100000000000
     or round(p_amount, 2) <> p_amount
     or char_length(coalesce(p_note, '')) > 2000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select o.* into v_offer
  from public.offers o
  where o.id = p_offer_id and o.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_offer.status::text not in ('submitted', 'countered') then
    return jsonb_build_object('outcome', 'invalid_state', 'current_status', v_offer.status);
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until < current_date then
    return jsonb_build_object('outcome', 'expired');
  end if;

  select coalesce(max(r.round_no), 0) + 1 into v_round
  from public.offer_rounds r where r.offer_id = p_offer_id;
  insert into public.offer_rounds (
    tenant_id, offer_id, round_no, side, amount, note, created_by
  ) values (
    p_tenant_id, p_offer_id, v_round, v_side, p_amount,
    nullif(btrim(coalesce(p_note, '')), ''), p_actor_id
  );
  update public.offers
  set status = case
        when v_side = 'seller' then 'countered'::public.offer_status
        else 'submitted'::public.offer_status
      end,
      amount = case when v_side = 'buyer' then p_amount else amount end,
      counter_amount = case when v_side = 'seller' then p_amount else null end,
      responded_at = case when v_side = 'seller' then clock_timestamp() else responded_at end,
      submitted_at = case when v_side = 'buyer' then clock_timestamp() else submitted_at end,
      updated_at = clock_timestamp()
  where id = p_offer_id and tenant_id = p_tenant_id and status = v_offer.status;
  if not found then
    raise exception 'Offer state changed while adding round.' using errcode = '40001';
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'offer.round', 'offer', p_offer_id,
    jsonb_build_object('status', v_offer.status, 'amount', v_offer.amount,
      'counter_amount', v_offer.counter_amount),
    jsonb_build_object('side', v_side, 'amount', p_amount, 'round_no', v_round)
  );
  return jsonb_build_object('outcome', 'created', 'round_no', v_round);
end;
$$;

revoke all on function public.add_offer_round_atomic(uuid, uuid, uuid, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.add_offer_round_atomic(uuid, uuid, uuid, text, numeric, text)
  to service_role;

create or replace function public.convert_offer_to_deal_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_offer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.offers%rowtype;
  v_deal_id uuid;
  v_deal_type text;
  v_transaction_type text;
  v_created boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_offer_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select o.* into v_offer
  from public.offers o
  where o.id = p_offer_id and o.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_offer.status <> 'accepted'::public.offer_status then
    return jsonb_build_object('outcome', 'invalid_state', 'current_status', v_offer.status);
  end if;
  if v_offer.deal_id is not null then
    return jsonb_build_object(
      'outcome', 'replay', 'deal_id', v_offer.deal_id, 'linked', true
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'offer-deal:' || p_tenant_id::text || ':' || v_offer.property_id::text || ':' ||
      coalesce(v_offer.customer_id::text, 'none'),
      0
    )
  );
  if v_offer.customer_id is not null then
    select d.id into v_deal_id
    from public.deals d
    where d.tenant_id = p_tenant_id
      and d.property_id = v_offer.property_id
      and d.customer_id = v_offer.customer_id
      and d.stage not in ('won', 'lost')
    order by d.created_at, d.id
    limit 1
    for update;
  end if;

  if v_deal_id is null then
    select p.transaction_type into v_transaction_type
    from public.properties p
    where p.id = v_offer.property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
    for update;
    if not found then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    v_deal_type := case
      when lower(coalesce(v_transaction_type, '')) like '%kira%'
        or lower(coalesce(v_transaction_type, '')) like '%rent%'
      then 'rent' else 'sale' end;
    insert into public.deals (
      tenant_id, property_id, customer_id, deal_type, stage,
      deal_value, probability, assigned_to
    ) values (
      p_tenant_id, v_offer.property_id, v_offer.customer_id, v_deal_type,
      'negotiation', v_offer.amount, 60, p_actor_id
    ) returning id into v_deal_id;
    v_created := true;
  end if;

  update public.offers
  set deal_id = v_deal_id, updated_at = clock_timestamp()
  where id = p_offer_id and tenant_id = p_tenant_id and deal_id is null;
  if not found then
    raise exception 'Offer link changed while converting.' using errcode = '40001';
  end if;

  insert into public.deal_notes (tenant_id, deal_id, author_id, body)
  values (
    p_tenant_id, v_deal_id, p_actor_id,
    'Kabul edilen tekliften atomik olarak dönüştürüldü.'
  );
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    p_tenant_id, p_actor_id, 'deal.from_offer', 'deal', v_deal_id,
    jsonb_build_object(
      'offer_id', p_offer_id, 'amount', v_offer.amount,
      'stage', 'negotiation', 'created', v_created
    )
  );
  return jsonb_build_object(
    'outcome', 'applied', 'deal_id', v_deal_id, 'linked', not v_created
  );
end;
$$;

revoke all on function public.convert_offer_to_deal_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_offer_to_deal_atomic(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Deals: stage, commission and property availability are one ledger event.
-- ---------------------------------------------------------------------------
create or replace function public.transition_deal_stage_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_deal_id uuid,
  p_stage text,
  p_loss_reason text default null,
  p_expected_stage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals%rowtype;
  v_property public.properties%rowtype;
  v_commission public.commissions%rowtype;
  v_stage text := lower(btrim(coalesce(p_stage, '')));
  v_value numeric;
  v_rate numeric;
  v_net numeric;
  v_vat numeric;
  v_advisor numeric;
  v_target_property_status text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_deal_id is null
     or v_stage not in ('new', 'qualified', 'negotiation', 'won', 'lost')
     or (p_expected_stage is not null
         and lower(btrim(p_expected_stage)) not in ('new', 'qualified', 'negotiation', 'won', 'lost'))
     or char_length(coalesce(p_loss_reason, '')) > 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select d.* into v_deal
  from public.deals d
  where d.id = p_deal_id and d.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_expected_stage is not null
     and v_deal.stage::text <> lower(btrim(p_expected_stage)) then
    return jsonb_build_object('outcome', 'conflict', 'current_stage', v_deal.stage);
  end if;
  if v_deal.stage = v_stage then
    return jsonb_build_object('outcome', 'replay', 'current_stage', v_stage);
  end if;
  if not (
    (v_deal.stage = 'new' and v_stage in ('qualified', 'lost'))
    or (v_deal.stage = 'qualified' and v_stage in ('negotiation', 'lost'))
    or (v_deal.stage = 'negotiation' and v_stage in ('won', 'lost'))
    or (v_deal.stage = 'won' and v_stage = 'negotiation')
    or (v_deal.stage = 'lost' and v_stage = 'negotiation')
  ) then
    return jsonb_build_object(
      'outcome', 'invalid_transition', 'current_stage', v_deal.stage,
      'requested_stage', v_stage
    );
  end if;
  if v_stage = 'lost' and nullif(btrim(coalesce(p_loss_reason, '')), '') is null then
    return jsonb_build_object('outcome', 'loss_reason_required');
  end if;

  if v_deal.stage = 'won' then
    if v_deal.deal_type = 'rent' and exists (
      select 1 from public.rentals r
      where r.tenant_id = p_tenant_id and r.deal_id = p_deal_id
    ) then
      return jsonb_build_object('outcome', 'rental_lifecycle_required');
    end if;
    select c.* into v_commission
    from public.commissions c
    where c.deal_id = p_deal_id and c.tenant_id = p_tenant_id
    for update;
    if found and v_commission.status in ('paid', 'collected') then
      return jsonb_build_object('outcome', 'commission_settled');
    end if;
    if found and exists (
      select 1 from public.payment_links pl
      where pl.tenant_id = p_tenant_id and pl.commission_id = v_commission.id
        and (
          pl.status in ('open', 'paid')
          or exists (
            select 1 from public.billing_payment_captures bpc
            where bpc.payment_link_id = pl.id
              and bpc.status <> 'refunded'
          )
        )
    ) then
      return jsonb_build_object('outcome', 'payment_in_progress');
    end if;
    if found then
      delete from public.commissions
      where id = v_commission.id and tenant_id = p_tenant_id;
    end if;

    update public.deals
    set stage = v_stage,
        closure_active = false,
        loss_reason = null,
        probability = 60,
        updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = 'won';
    if not found then
      raise exception 'Deal state changed while reopening.' using errcode = '40001';
    end if;

    if v_deal.property_id is not null
       and not exists (
         select 1 from public.deals d
         where d.tenant_id = p_tenant_id
           and d.property_id = v_deal.property_id
           and d.id <> p_deal_id and d.closure_active = true
       ) then
      update public.properties
      set status = case
            when v_deal.prev_property_status is null
              or v_deal.prev_property_status in ('sold', 'rented') then 'live'
            else v_deal.prev_property_status
          end,
          updated_at = v_now
      where id = v_deal.property_id and tenant_id = p_tenant_id
        and status = case when v_deal.deal_type = 'rent' then 'rented' else 'sold' end;
    end if;
  elsif v_stage = 'won' then
    if v_deal.property_id is null then
      return jsonb_build_object('outcome', 'property_required');
    end if;
    if v_deal.customer_id is null then
      return jsonb_build_object('outcome', 'customer_required');
    end if;
    if not exists (
      select 1 from public.customers c
      where c.id = v_deal.customer_id and c.tenant_id = p_tenant_id and c.deleted_at is null
    ) then
      return jsonb_build_object('outcome', 'customer_not_found');
    end if;

    select p.* into v_property
    from public.properties p
    where p.id = v_deal.property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
    for update;
    if not found then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    if exists (
      select 1 from public.deals d
      where d.tenant_id = p_tenant_id and d.property_id = v_deal.property_id
        and d.id <> p_deal_id and d.closure_active = true
    ) then
      return jsonb_build_object('outcome', 'property_already_closed');
    end if;
    if (v_deal.deal_type = 'sale' and v_property.status = 'rented')
       or (v_deal.deal_type = 'rent' and v_property.status = 'sold') then
      return jsonb_build_object('outcome', 'property_unavailable');
    end if;
    if v_deal.deal_type = 'rent' and exists (
      select 1 from public.rentals r
      where r.tenant_id = p_tenant_id
        and r.property_id = v_deal.property_id
        and r.status = 'active'
    ) then
      return jsonb_build_object('outcome', 'property_active_rental');
    end if;

    v_value := coalesce(nullif(v_deal.deal_value, 0), nullif(v_property.list_price, 0));
    if v_value is null or v_value <= 0 then
      return jsonb_build_object('outcome', 'deal_value_required');
    end if;
    if v_property.commission_rate is null
       or v_property.commission_rate <= 0
       or v_property.commission_rate > 100
       or round(v_property.commission_rate, 2) <> v_property.commission_rate then
      return jsonb_build_object('outcome', 'commission_rate_required');
    end if;
    v_rate := v_property.commission_rate;
    v_net := round(v_value * (v_rate / 100), 2);
    v_vat := round(v_net * 0.20, 2);
    v_advisor := round(v_net * 0.50, 2);
    v_target_property_status := case when v_deal.deal_type = 'rent' then 'rented' else 'sold' end;

    update public.deals
    set stage = 'won', deal_value = v_value, loss_reason = null,
        closure_active = true,
        prev_property_status = case
          when v_property.status in ('sold', 'rented') then coalesce(v_deal.prev_property_status, 'live')
          else v_property.status
        end,
        probability = 100, updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = v_deal.stage;
    if not found then
      raise exception 'Deal state changed while closing.' using errcode = '40001';
    end if;

    insert into public.commissions (
      tenant_id, deal_id, gross_amount, vat_amount, status, splits
    ) values (
      p_tenant_id, p_deal_id, v_net, v_vat, 'calculated',
      jsonb_build_array(
        jsonb_build_object('label', 'Danışman', 'rate', 50, 'amount', v_advisor),
        jsonb_build_object('label', 'Ofis', 'rate', 50, 'amount', v_net - v_advisor)
      )
    )
    on conflict (deal_id) where deal_id is not null do nothing;
    if not found then
      raise exception 'Commission already exists for open deal.' using errcode = '23505';
    end if;

    update public.properties
    set status = v_target_property_status, updated_at = v_now
    where id = v_deal.property_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Property disappeared while closing deal.' using errcode = '40001';
    end if;
  else
    update public.deals
    set stage = v_stage,
        loss_reason = case when v_stage = 'lost' then btrim(p_loss_reason) else null end,
        probability = case v_stage
          when 'lost' then 0 when 'negotiation' then 60
          when 'qualified' then 40 else 20 end,
        updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = v_deal.stage;
    if not found then
      raise exception 'Deal state changed while transitioning.' using errcode = '40001';
    end if;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'deal.stage', 'deal', p_deal_id,
    jsonb_build_object('stage', v_deal.stage),
    jsonb_build_object('stage', v_stage, 'loss_reason', nullif(btrim(coalesce(p_loss_reason, '')), ''))
  );
  return jsonb_build_object(
    'outcome', 'applied', 'previous_stage', v_deal.stage, 'current_stage', v_stage,
    'property_id', v_deal.property_id, 'customer_id', v_deal.customer_id,
    'deal_type', v_deal.deal_type, 'deal_value', coalesce(v_value, v_deal.deal_value)
  );
end;
$$;

revoke all on function public.transition_deal_stage_atomic(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_deal_stage_atomic(uuid, uuid, uuid, text, text, text)
  to service_role;

create or replace function public.create_won_deal_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_property_id uuid,
  p_customer_id uuid,
  p_deal_type text,
  p_deal_value numeric default null,
  p_advisor_share numeric default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal_id uuid;
  v_result jsonb;
  v_property public.properties%rowtype;
  v_share numeric := least(100, greatest(0, coalesce(p_advisor_share, 50)));
  v_commission public.commissions%rowtype;
  v_advisor numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_property_id is null
     or p_customer_id is null or p_deal_type not in ('sale', 'rent')
     or (p_deal_value is not null and (p_deal_value <= 0 or p_deal_value > 100000000000)) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- The property row is the mutex shared by all closing paths.
  select p.* into v_property
  from public.properties p
  where p.id = p_property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
  for update;
  if not found then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  if v_property.commission_rate is null
     or v_property.commission_rate <= 0
     or v_property.commission_rate > 100
     or round(v_property.commission_rate, 2) <> v_property.commission_rate then
    return jsonb_build_object('outcome', 'commission_rate_required');
  end if;
  if exists (
    select 1 from public.deals d
    where d.tenant_id = p_tenant_id and d.property_id = p_property_id and d.closure_active = true
  ) then
    return jsonb_build_object('outcome', 'property_already_closed');
  end if;

  insert into public.deals (
    tenant_id, property_id, customer_id, deal_type, stage,
    deal_value, probability, assigned_to
  ) values (
    p_tenant_id, p_property_id, p_customer_id, p_deal_type, 'negotiation',
    p_deal_value, 60, p_actor_id
  ) returning id into v_deal_id;

  v_result := public.transition_deal_stage_atomic(
    p_tenant_id, p_actor_id, v_deal_id, 'won', null, 'negotiation'
  );
  if v_result ->> 'outcome' <> 'applied' then
    raise exception 'Won deal invariant rejected: %', v_result ->> 'outcome'
      using errcode = 'P0001';
  end if;

  select c.* into v_commission
  from public.commissions c
  where c.tenant_id = p_tenant_id and c.deal_id = v_deal_id
  for update;
  if not found then
    raise exception 'Commission was not created.' using errcode = '40001';
  end if;
  v_advisor := round(v_commission.gross_amount * (v_share / 100), 2);
  update public.commissions
  set splits = jsonb_build_array(
    jsonb_build_object('label', 'Danışman', 'rate', v_share, 'amount', v_advisor),
    jsonb_build_object('label', 'Ofis', 'rate', 100 - v_share, 'amount', v_commission.gross_amount - v_advisor)
  )
  where id = v_commission.id;

  return jsonb_build_object(
    'outcome', 'created', 'deal_id', v_deal_id, 'commission_id', v_commission.id,
    'property_status', case when p_deal_type = 'rent' then 'rented' else 'sold' end
  );
end;
$$;

revoke all on function public.create_won_deal_atomic(
  uuid, uuid, uuid, uuid, text, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.create_won_deal_atomic(
  uuid, uuid, uuid, uuid, text, numeric, numeric
) to service_role;

-- ---------------------------------------------------------------------------
-- Rentals: active lease, property availability and renter classification move
-- together; ending a lease restores only the state owned by that lease.
-- ---------------------------------------------------------------------------
create or replace function public.create_rental_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_property_id uuid,
  p_renter_id uuid,
  p_monthly_rent numeric,
  p_due_day integer,
  p_start_date date,
  p_end_date date default null,
  p_deposit numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_property public.properties%rowtype;
  v_deal public.deals%rowtype;
  v_rental_id uuid;
  v_deal_id uuid;
  v_transition jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_property_id is null or p_renter_id is null
     or p_monthly_rent is null or p_monthly_rent < 0.01 or p_monthly_rent > 1000000000
     or round(p_monthly_rent, 2) <> p_monthly_rent
     or p_due_day not between 1 and 28 or p_start_date is null
     or (p_end_date is not null and p_end_date <= p_start_date)
     or (p_deposit is not null and (
       p_deposit < 0 or p_deposit > 1000000000 or round(p_deposit, 2) <> p_deposit
     ))
     or char_length(coalesce(p_notes, '')) > 5000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select p.* into v_property
  from public.properties p
  where p.id = p_property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
  for update;
  if not found then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  if exists (
    select 1 from public.rentals r
    where r.tenant_id = p_tenant_id and r.property_id = p_property_id and r.status = 'active'
  ) then
    return jsonb_build_object('outcome', 'property_unavailable');
  end if;
  perform 1 from public.customers c
  where c.id = p_renter_id and c.tenant_id = p_tenant_id and c.deleted_at is null
  for update;
  if not found then
    return jsonb_build_object('outcome', 'renter_not_found');
  end if;

  -- Reuse the same customer's already-closed rent deal (for example a portal
  -- close), otherwise promote their newest open rent deal or create one.
  select d.* into v_deal
  from public.deals d
  where d.tenant_id = p_tenant_id and d.property_id = p_property_id
    and d.customer_id = p_renter_id and d.deal_type = 'rent'
    and d.stage = 'won' and d.closure_active = true
  order by d.updated_at desc
  limit 1
  for update;

  if not found then
    if v_property.commission_rate is null
       or v_property.commission_rate <= 0
       or v_property.commission_rate > 100
       or round(v_property.commission_rate, 2) <> v_property.commission_rate then
      return jsonb_build_object('outcome', 'commission_rate_required');
    end if;
    if v_property.status in ('sold', 'rented') then
      return jsonb_build_object('outcome', 'property_unavailable');
    end if;
    select d.* into v_deal
    from public.deals d
    where d.tenant_id = p_tenant_id and d.property_id = p_property_id
      and d.customer_id = p_renter_id and d.deal_type = 'rent'
      and d.stage in ('new', 'qualified', 'negotiation')
    order by d.updated_at desc
    limit 1
    for update;
    if not found then
      insert into public.deals (
        tenant_id, property_id, customer_id, deal_type, stage,
        deal_value, probability, assigned_to, prev_property_status
      ) values (
        p_tenant_id, p_property_id, p_renter_id, 'rent', 'negotiation',
        p_monthly_rent, 60, p_actor_id, v_property.status
      ) returning * into v_deal;
    else
      update public.deals
      set stage = 'negotiation', deal_value = p_monthly_rent,
          probability = 60, assigned_to = coalesce(assigned_to, p_actor_id),
          prev_property_status = v_property.status, updated_at = clock_timestamp()
      where id = v_deal.id and tenant_id = p_tenant_id
      returning * into v_deal;
    end if;
    v_transition := public.transition_deal_stage_atomic(
      p_tenant_id, p_actor_id, v_deal.id, 'won', null, 'negotiation'
    );
    if v_transition ->> 'outcome' <> 'applied' then
      raise exception 'Rental deal close rejected: %', v_transition ->> 'outcome'
        using errcode = 'P0001';
    end if;
  end if;
  v_deal_id := v_deal.id;

  insert into public.rentals (
    tenant_id, created_by, property_id, renter_customer_id, monthly_rent,
    due_day, start_date, end_date, deposit, notes, status, prev_property_status, deal_id
  ) values (
    p_tenant_id, p_actor_id, p_property_id, p_renter_id, p_monthly_rent,
    p_due_day, p_start_date, p_end_date, p_deposit,
    nullif(btrim(coalesce(p_notes, '')), ''), 'active',
    coalesce(v_deal.prev_property_status, v_property.status), v_deal_id
  ) returning id into v_rental_id;

  update public.properties
  set status = 'rented', updated_at = clock_timestamp()
  where id = p_property_id and tenant_id = p_tenant_id;
  update public.customers
  set customer_types = case
    when coalesce(customer_types, '{}'::text[]) @> array['Kiracı']::text[] then customer_types
    else array_append(coalesce(customer_types, '{}'::text[]), 'Kiracı') end,
      updated_at = clock_timestamp()
  where id = p_renter_id and tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    p_tenant_id, p_actor_id, 'rental.create', 'rental', v_rental_id,
    jsonb_build_object(
      'property_id', p_property_id, 'renter_id', p_renter_id,
      'monthly_rent', p_monthly_rent, 'status', 'active', 'deal_id', v_deal_id
    )
  );
  return jsonb_build_object(
    'outcome', 'created', 'rental_id', v_rental_id, 'deal_id', v_deal_id
  );
end;
$$;

revoke all on function public.create_rental_atomic(
  uuid, uuid, uuid, uuid, numeric, integer, date, date, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_rental_atomic(
  uuid, uuid, uuid, uuid, numeric, integer, date, date, numeric, text
) to service_role;

create or replace function public.end_rental_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_rental_id uuid,
  p_end_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rental public.rentals%rowtype;
  v_restore text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_rental_id is null or p_end_date is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select r.* into v_rental
  from public.rentals r
  where r.id = p_rental_id and r.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_rental.status = 'ended' then
    return jsonb_build_object('outcome', 'replay', 'property_id', v_rental.property_id);
  end if;
  if p_end_date < v_rental.start_date then
    return jsonb_build_object('outcome', 'invalid_end_date');
  end if;

  perform 1 from public.properties p
  where p.id = v_rental.property_id and p.tenant_id = p_tenant_id
  for update;

  update public.rentals
  set status = 'ended', end_date = coalesce(v_rental.end_date, p_end_date)
  where id = p_rental_id and tenant_id = p_tenant_id and status = 'active';
  if not found then
    raise exception 'Rental state changed while ending.' using errcode = '40001';
  end if;

  v_restore := case
    when v_rental.prev_property_status is null
      or v_rental.prev_property_status in ('sold', 'rented') then 'live'
    else v_rental.prev_property_status end;
  update public.properties
  set status = v_restore, updated_at = v_now
  where id = v_rental.property_id and tenant_id = p_tenant_id and status = 'rented';

  if v_rental.deal_id is not null then
    update public.deals
    set closure_active = false, updated_at = v_now
    where id = v_rental.deal_id and tenant_id = p_tenant_id
      and stage = 'won' and closure_active = true;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'rental.end', 'rental', p_rental_id,
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'ended', 'end_date', coalesce(v_rental.end_date, p_end_date))
  );
  return jsonb_build_object(
    'outcome', 'applied', 'property_id', v_rental.property_id, 'property_status', v_restore
  );
end;
$$;

revoke all on function public.end_rental_atomic(uuid, uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.end_rental_atomic(uuid, uuid, uuid, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- Portal closure: closure evidence, listing state and (when applicable) the
-- won deal/commission ledger commit or roll back as one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.close_portal_listing_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_listing_id uuid,
  p_reason text,
  p_deal_happened boolean,
  p_closed_by_us boolean,
  p_competitor_closed boolean,
  p_deal_amount numeric default null,
  p_customer_id uuid default null,
  p_authority_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing public.portal_listings%rowtype;
  v_property public.properties%rowtype;
  v_base numeric;
  v_rate numeric;
  v_lost numeric := 0;
  v_deal_type text;
  v_close_result jsonb;
  v_existing_deal_id uuid;
  v_existing_commission_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_listing_id is null
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500
     or (p_deal_amount is not null and (p_deal_amount <= 0 or p_deal_amount > 100000000000))
     or (coalesce(p_closed_by_us, false) and coalesce(p_competitor_closed, false)) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if coalesce(p_closed_by_us, false) and coalesce(p_deal_happened, false)
     and (p_customer_id is null or not coalesce(p_authority_confirmed, false)) then
    return jsonb_build_object('outcome', 'closing_evidence_required');
  end if;

  select l.* into v_listing
  from public.portal_listings l
  where l.id = p_listing_id and l.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_listing.status = 'removed' then
    return jsonb_build_object('outcome', 'replay');
  end if;

  select p.* into v_property
  from public.properties p
  where p.id = v_listing.property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
  for update;
  if not found then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;

  v_base := coalesce(nullif(p_deal_amount, 0), nullif(v_property.list_price, 0), 0);
  if v_property.commission_rate is null
     or v_property.commission_rate <= 0
     or v_property.commission_rate > 100
     or round(v_property.commission_rate, 2) <> v_property.commission_rate then
    return jsonb_build_object('outcome', 'commission_rate_required');
  end if;
  v_rate := v_property.commission_rate;
  if coalesce(p_competitor_closed, false)
     or (coalesce(p_deal_happened, false) and not coalesce(p_closed_by_us, false)) then
    v_lost := round(v_base * (v_rate / 100), 2);
  end if;

  if coalesce(p_closed_by_us, false) and coalesce(p_deal_happened, false) then
    v_deal_type := case
      when lower(coalesce(v_property.transaction_type, '')) like '%kira%'
        or lower(coalesce(v_property.transaction_type, '')) like '%rent%'
      then 'rent' else 'sale' end;
    select d.id, c.id into v_existing_deal_id, v_existing_commission_id
    from public.deals d
    join public.commissions c
      on c.deal_id = d.id and c.tenant_id = d.tenant_id
    where d.tenant_id = p_tenant_id and d.property_id = v_property.id
      and d.customer_id = p_customer_id and d.deal_type = v_deal_type
      and d.stage = 'won' and d.closure_active = true
    order by d.updated_at desc
    limit 1;
    if v_existing_deal_id is not null then
      v_close_result := jsonb_build_object(
        'outcome', 'created', 'deal_id', v_existing_deal_id,
        'commission_id', v_existing_commission_id, 'reused', true
      );
    else
      v_close_result := public.create_won_deal_atomic(
        p_tenant_id, p_actor_id, v_property.id, p_customer_id, v_deal_type,
        nullif(v_base, 0), 50
      );
      if v_close_result ->> 'outcome' <> 'created' then
        raise exception 'Portal deal close rejected: %', v_close_result ->> 'outcome'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.listing_closures (
    tenant_id, portal_listing_id, reason, deal_happened, deal_amount,
    closed_by_us, competitor_closed, estimated_lost_commission, created_by
  ) values (
    p_tenant_id, p_listing_id, btrim(p_reason), coalesce(p_deal_happened, false),
    nullif(v_base, 0), coalesce(p_closed_by_us, false),
    coalesce(p_competitor_closed, false), v_lost, p_actor_id
  );
  update public.portal_listings
  set status = 'removed', removed_at = v_now, removal_reason = btrim(p_reason),
      removal_meta = jsonb_build_object(
        'estimated_lost_commission', v_lost,
        'closed_by_us', coalesce(p_closed_by_us, false),
        'competitor_closed', coalesce(p_competitor_closed, false)
      )
  where id = p_listing_id and tenant_id = p_tenant_id and status <> 'removed';
  if not found then
    raise exception 'Listing state changed while closing.' using errcode = '40001';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'portal.close', 'portal_listing', p_listing_id,
    jsonb_build_object('status', v_listing.status),
    jsonb_build_object(
      'status', 'removed', 'reason', btrim(p_reason),
      'estimated_lost_commission', v_lost,
      'deal_id', v_close_result ->> 'deal_id'
    )
  );
  return jsonb_build_object(
    'outcome', 'applied', 'estimated_lost_commission', v_lost,
    'deal_id', v_close_result ->> 'deal_id',
    'commission_id', v_close_result ->> 'commission_id'
  );
end;
$$;

revoke all on function public.close_portal_listing_atomic(
  uuid, uuid, uuid, text, boolean, boolean, boolean, numeric, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.close_portal_listing_atomic(
  uuid, uuid, uuid, text, boolean, boolean, boolean, numeric, uuid, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- Open house: a visitor is claimed, de-duplicated and linked in one commit.
-- ---------------------------------------------------------------------------
create or replace function public.convert_open_house_visitor_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_open_house_id uuid,
  p_visitor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visitor public.open_house_visitors%rowtype;
  v_customer_id uuid;
  v_phone text;
  v_digits text;
  v_created boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null
     or p_open_house_id is null or p_visitor_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select v.* into v_visitor
  from public.open_house_visitors v
  join public.open_houses h
    on h.id = v.open_house_id and h.tenant_id = p_tenant_id
  where h.id = p_open_house_id and v.id = p_visitor_id
  for update of v;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_visitor.created_customer_id is not null then
    return jsonb_build_object(
      'outcome', 'replay', 'customer_id', v_visitor.created_customer_id
    );
  end if;
  if char_length(btrim(v_visitor.full_name)) not between 1 and 200 then
    return jsonb_build_object('outcome', 'invalid_visitor');
  end if;

  v_digits := regexp_replace(coalesce(v_visitor.phone, ''), '[^0-9]', '', 'g');
  if left(v_digits, 4) = '0090' then
    v_digits := substring(v_digits from 3);
  end if;
  if left(v_digits, 2) = '90' and char_length(v_digits) >= 12 then
    v_digits := '0' || substring(v_digits from 3);
  end if;
  if char_length(v_digits) = 10 and left(v_digits, 1) = '5' then
    v_digits := '0' || v_digits;
  end if;
  v_phone := left(v_digits, 11);
  if v_phone !~ '^05[0-9]{9}$' then
    v_phone := null;
  end if;

  if v_phone is not null then
    -- All conversions for the same tenant/phone serialize, so two visitors
    -- cannot create two customers at the same instant.
    perform pg_advisory_xact_lock(
      hashtextextended(p_tenant_id::text || ':' || v_phone, 0)
    );
    select c.id into v_customer_id
    from public.customers c
    where c.tenant_id = p_tenant_id
      and c.phone = v_phone
      and c.deleted_at is null
    order by c.created_at, c.id
    limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (
      tenant_id, full_name, phone, email, customer_types, notes,
      lead_source, assigned_to, created_by
    ) values (
      p_tenant_id,
      btrim(v_visitor.full_name),
      v_phone,
      nullif(lower(btrim(coalesce(v_visitor.email, ''))), ''),
      array['Alıcı']::text[],
      case when nullif(btrim(coalesce(v_visitor.notes, '')), '') is not null
        then 'Açık ev notu: ' || left(btrim(v_visitor.notes), 5000)
        else null end,
      'open_house',
      p_actor_id,
      p_actor_id
    ) returning id into v_customer_id;
    v_created := true;
  end if;

  update public.open_house_visitors
  set created_customer_id = v_customer_id
  where id = p_visitor_id
    and open_house_id = p_open_house_id
    and created_customer_id is null;
  if not found then
    raise exception 'Visitor state changed while converting.' using errcode = '40001';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    p_tenant_id, p_actor_id, 'open_house.visitor_converted',
    'open_house_visitor', p_visitor_id,
    jsonb_build_object(
      'open_house_id', p_open_house_id,
      'customer_id', v_customer_id,
      'customer_created', v_created
    )
  );

  return jsonb_build_object(
    'outcome', case when v_created then 'created' else 'linked' end,
    'customer_id', v_customer_id
  );
end;
$$;

revoke all on function public.convert_open_house_visitor_atomic(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.convert_open_house_visitor_atomic(
  uuid, uuid, uuid, uuid
) to service_role;

-- OTP storage rechecks the live contract and signer under row locks. A
-- concurrent cancellation therefore wins completely or loses completely;
-- it can never leave a rejected signer with a fresh OTP.
create or replace function public.store_contract_signer_otp_atomic(
  p_token text,
  p_otp_hash text,
  p_otp_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_signer public.contract_signers%rowtype;
  v_contract_id uuid;
  v_tenant_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 24 and 256
     or p_otp_hash is null or p_otp_hash !~ '^hmac-sha256-v1:[0-9a-f]{64}$'
     or p_otp_expires_at is null
     or p_otp_expires_at <= clock_timestamp()
     or p_otp_expires_at > clock_timestamp() + interval '10 minutes' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select cs.contract_id into v_contract_id
  from public.contract_signers cs where cs.token = p_token;
  if not found then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;

  select c.* into v_contract
  from public.contracts c
  join public.tenants t on t.id = c.tenant_id
  where c.id = v_contract_id
  for update of c;
  if found then
    select t.status::text into v_tenant_status from public.tenants t where t.id = v_contract.tenant_id;
  end if;
  if not found or v_tenant_status not in ('trial', 'active', 'past_due') then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;
  if v_contract.status <> 'sent'::public.contract_status then
    return jsonb_build_object('outcome', 'invalid_state');
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at <= clock_timestamp() then
    return jsonb_build_object('outcome', 'expired');
  end if;

  select cs.* into v_signer
  from public.contract_signers cs
  where cs.token = p_token and cs.contract_id = v_contract.id
  for update;
  if not found or v_signer.status <> 'pending'::public.signer_status then
    return jsonb_build_object('outcome', 'invalid_state');
  end if;

  update public.contract_signers
  set otp_hash = p_otp_hash, otp_expires_at = p_otp_expires_at, otp_attempts = 0
  where id = v_signer.id and status = 'pending'::public.signer_status;
  if not found then
    raise exception 'Signer state changed while storing OTP.' using errcode = '40001';
  end if;
  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke all on function public.store_contract_signer_otp_atomic(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_contract_signer_otp_atomic(text, text, timestamptz)
  to service_role;

-- A sent offer amount is an immutable business assertion. Corrections use a
-- new negotiation round; this RPC only edits non-financial metadata while
-- confirming that the caller rendered the current canonical amount.
create or replace function public.update_offer_terms_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_offer_id uuid,
  p_expected_amount numeric,
  p_valid_until date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.offers%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_offer_id is null
     or p_expected_amount is null or p_expected_amount < 0.01
     or p_expected_amount > 100000000000
     or round(p_expected_amount, 2) <> p_expected_amount
     or char_length(coalesce(p_notes, '')) > 5000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if p_valid_until is not null and p_valid_until < current_date then
    return jsonb_build_object('outcome', 'expired');
  end if;

  select o.* into v_offer from public.offers o
  where o.id = p_offer_id and o.tenant_id = p_tenant_id
  for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_offer.status::text not in ('submitted', 'countered') then
    return jsonb_build_object('outcome', 'invalid_state');
  end if;
  if v_offer.amount <> p_expected_amount then
    return jsonb_build_object('outcome', 'amount_immutable', 'current_amount', v_offer.amount);
  end if;
  if v_offer.valid_until is not distinct from p_valid_until
     and v_offer.notes is not distinct from v_notes then
    return jsonb_build_object('outcome', 'replay');
  end if;

  update public.offers
  set valid_until = p_valid_until, notes = v_notes, updated_at = clock_timestamp()
  where id = p_offer_id and tenant_id = p_tenant_id
    and status = v_offer.status and amount = v_offer.amount;
  if not found then
    raise exception 'Offer state changed while editing.' using errcode = '40001';
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'offer.terms', 'offer', p_offer_id,
    jsonb_build_object('valid_until', v_offer.valid_until, 'notes', v_offer.notes),
    jsonb_build_object('valid_until', p_valid_until, 'notes', v_notes)
  );
  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke all on function public.update_offer_terms_atomic(uuid, uuid, uuid, numeric, date, text)
  from public, anon, authenticated;
grant execute on function public.update_offer_terms_atomic(uuid, uuid, uuid, numeric, date, text)
  to service_role;

-- Project stock, won deal, commission and trace note are one sale event.
create or replace function public.sell_project_unit_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_unit_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit public.project_units%rowtype;
  v_deal_id uuid;
  v_project_name text;
  v_net numeric;
  v_vat numeric;
  v_advisor numeric;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_unit_id is null or p_customer_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.is_active = true
  ) then return jsonb_build_object('outcome', 'actor_not_found'); end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id and c.deleted_at is null
  ) then return jsonb_build_object('outcome', 'customer_not_found'); end if;

  select u.* into v_unit from public.project_units u
  where u.id = p_unit_id and u.tenant_id = p_tenant_id
  for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  select d.id into v_deal_id from public.deals d
  where d.tenant_id = p_tenant_id and d.project_unit_id = p_unit_id;
  if v_unit.status = 'sold' then
    if v_deal_id is not null and v_unit.customer_id = p_customer_id then
      return jsonb_build_object('outcome', 'replay', 'deal_id', v_deal_id);
    end if;
    return jsonb_build_object('outcome', 'already_sold');
  end if;
  if v_unit.list_price is null or v_unit.list_price < 0.01 then
    return jsonb_build_object('outcome', 'price_required');
  end if;

  update public.project_units
  set status = 'sold', customer_id = p_customer_id,
      sold_at = v_now, reserved_until = null
  where id = p_unit_id and tenant_id = p_tenant_id and status = v_unit.status;
  if not found then
    raise exception 'Project unit changed while selling.' using errcode = '40001';
  end if;

  insert into public.deals (
    tenant_id, project_unit_id, property_id, customer_id, deal_type,
    stage, deal_value, probability, assigned_to
  ) values (
    p_tenant_id, p_unit_id, null, p_customer_id, 'sale',
    'won', v_unit.list_price, 100, p_actor_id
  ) returning id into v_deal_id;

  v_net := round(v_unit.list_price * 0.03, 2);
  v_vat := round(v_net * 0.20, 2);
  v_advisor := round(v_net * 0.50, 2);
  insert into public.commissions (
    tenant_id, deal_id, gross_amount, vat_amount, status, splits
  ) values (
    p_tenant_id, v_deal_id, v_net, v_vat, 'calculated',
    jsonb_build_array(
      jsonb_build_object('label', 'Danışman', 'rate', 50, 'amount', v_advisor),
      jsonb_build_object('label', 'Ofis', 'rate', 50, 'amount', v_net - v_advisor)
    )
  );

  select p.name into v_project_name from public.projects p
  where p.id = v_unit.project_id and p.tenant_id = p_tenant_id;
  insert into public.deal_notes (tenant_id, deal_id, author_id, body)
  values (
    p_tenant_id, v_deal_id, p_actor_id,
    left(format('Proje satışı — %s · %s', coalesce(v_project_name, 'Proje'),
      concat_ws(' / ', v_unit.block, v_unit.unit_no)), 2000)
  );
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'project_unit.sale', 'project_unit', p_unit_id,
    jsonb_build_object('status', v_unit.status, 'customer_id', v_unit.customer_id),
    jsonb_build_object('status', 'sold', 'customer_id', p_customer_id,
      'deal_id', v_deal_id, 'amount', v_unit.list_price)
  );
  return jsonb_build_object('outcome', 'applied', 'deal_id', v_deal_id);
end;
$$;

revoke all on function public.sell_project_unit_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sell_project_unit_atomic(uuid, uuid, uuid, uuid)
  to service_role;

-- Manual portfolio status changes and their audit history share a transaction.
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
as $$
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
$$;

revoke all on function public.transition_property_status_atomic(uuid, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.transition_property_status_atomic(uuid, uuid, uuid[], text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Database backstops: authenticated PostgREST writes must not bypass the
-- atomic terminal workflows, and concurrent writers get a hard uniqueness
-- guarantee even if a future caller forgets the advisory/application checks.
-- ---------------------------------------------------------------------------
-- These two repairs are deterministic: a submitted offer's canonical amount
-- is its initial buyer round, and an active lease makes the customer a renter.
insert into public.offer_rounds (
  tenant_id, offer_id, round_no, side, amount, note, created_by, created_at
)
select o.tenant_id, o.id, 1, 'buyer', o.amount, o.notes, o.created_by,
  coalesce(o.submitted_at, o.created_at)
from public.offers o
where o.status in ('submitted', 'accepted')
  and o.amount >= 0.01 and o.amount <= 100000000000
  and round(o.amount, 2) = o.amount
  and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id);

update public.customers c
set customer_types = array_append(coalesce(c.customer_types, '{}'::text[]), 'Kiracı'),
    updated_at = clock_timestamp()
where not coalesce(c.customer_types, '{}'::text[]) @> array['Kiracı']::text[]
  and exists (
    select 1 from public.rentals r
    where r.tenant_id = c.tenant_id and r.renter_customer_id = c.id
      and r.status = 'active'
  );

do $$
declare
  v_won_property_status bigint;
  v_won_commission bigint;
  v_duplicate_closure bigint;
  v_won_financial bigint;
  v_won_asset bigint;
  v_rental_property bigint;
  v_rental_prev bigint;
  v_duplicate_rental bigint;
  v_rental_deal bigint;
  v_rental_commission bigint;
  v_unit_deal bigint;
  v_unit_commission bigint;
  v_project_unit_deal bigint;
  v_accepted_history bigint;
  v_counter_history bigint;
  v_counter_amount bigint;
  v_offer_financial bigint;
  v_non_won_commission bigint;
begin
  select count(*) into v_won_property_status
  from public.deals d
  left join public.properties p on p.id = d.property_id and p.tenant_id = d.tenant_id
  where d.stage = 'won' and d.property_id is not null
    and (p.id is null or p.status <> case when d.deal_type = 'rent' then 'rented' else 'sold' end);

  select count(*) into v_won_commission
  from public.deals d
  where d.stage = 'won' and not exists (
    select 1 from public.commissions c
    where c.tenant_id = d.tenant_id and c.deal_id = d.id
  );

  select count(*) into v_duplicate_closure from (
    select d.tenant_id, d.property_id
    from public.deals d
    join public.properties p on p.id = d.property_id and p.tenant_id = d.tenant_id
    where d.stage = 'won'
      and p.status = case when d.deal_type = 'rent' then 'rented' else 'sold' end
    group by d.tenant_id, d.property_id having count(*) > 1
  ) duplicate_won;

  select count(*) into v_won_financial
  from public.deals d
  left join public.properties p on p.id = d.property_id and p.tenant_id = d.tenant_id
  where d.stage = 'won' and (
    d.deal_value is null or d.deal_value <= 0
    or (d.property_id is not null and (
      p.commission_rate is null or p.commission_rate <= 0 or p.commission_rate > 100
      or round(p.commission_rate, 2) <> p.commission_rate
    ))
  );

  select count(*) into v_won_asset from public.deals d
  where d.stage = 'won' and d.property_id is null and d.project_unit_id is null;

  select count(*) into v_rental_property
  from public.rentals r
  left join public.properties p on p.id = r.property_id and p.tenant_id = r.tenant_id
  where r.status = 'active' and p.status is distinct from 'rented';

  select count(*) into v_rental_prev from public.rentals r
  where r.status = 'active'
    and (r.prev_property_status is null or r.prev_property_status in ('sold', 'rented'));

  select count(*) into v_duplicate_rental from (
    select r.tenant_id, r.property_id from public.rentals r
    where r.status = 'active'
    group by r.tenant_id, r.property_id having count(*) > 1
  ) duplicate_active;

  select count(*) into v_rental_deal from public.rentals r
  where r.status = 'active' and (r.deal_id is null or not exists (
    select 1 from public.deals d
    where d.id = r.deal_id and d.tenant_id = r.tenant_id
      and d.stage = 'won' and d.deal_type = 'rent'
      and d.property_id = r.property_id and d.customer_id = r.renter_customer_id
  ));

  select count(*) into v_rental_commission from public.rentals r
  where r.status = 'active' and (r.deal_id is null or not exists (
    select 1 from public.commissions c
    where c.tenant_id = r.tenant_id and c.deal_id = r.deal_id
  ));

  select count(*) into v_unit_deal from public.project_units u
  where u.status = 'sold' and (
    u.customer_id is null or u.sold_at is null or u.list_price is null or u.list_price <= 0
    or round(u.list_price, 2) <> u.list_price
    or 1 <> (select count(*) from public.deals d
      where d.tenant_id = u.tenant_id and d.project_unit_id = u.id
        and d.stage = 'won' and d.deal_type = 'sale' and d.customer_id = u.customer_id
        and d.deal_value = u.list_price)
  );

  select count(*) into v_unit_commission from public.project_units u
  where u.status = 'sold' and not exists (
    select 1 from public.deals d
    join public.commissions c on c.tenant_id = d.tenant_id and c.deal_id = d.id
    where d.tenant_id = u.tenant_id and d.project_unit_id = u.id
      and d.stage = 'won' and d.deal_type = 'sale'
      and d.customer_id = u.customer_id and d.deal_value = u.list_price
  );

  select count(*) into v_project_unit_deal from public.deals d
  left join public.project_units u
    on u.id = d.project_unit_id and u.tenant_id = d.tenant_id
  where d.stage = 'won' and d.project_unit_id is not null and (
    u.id is null or u.status <> 'sold' or d.deal_type <> 'sale'
    or u.customer_id is null or d.customer_id is distinct from u.customer_id
    or u.list_price is null or u.list_price <= 0
    or round(u.list_price, 2) <> u.list_price
    or d.deal_value is distinct from u.list_price
  );

  select count(*) into v_accepted_history from public.offers o
  where o.status in ('submitted', 'accepted')
    and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id);

  select count(*) into v_counter_history from public.offers o
  where o.status = 'countered'
    and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id);

  select count(*) into v_counter_amount from public.offers o
  join lateral (
    select r.side, r.amount from public.offer_rounds r
    where r.offer_id = o.id order by r.round_no desc limit 1
  ) latest on true
  where (o.status = 'submitted' and (
      latest.side <> 'buyer' or latest.amount is distinct from o.amount
      or o.counter_amount is not null
    )) or (o.status = 'countered' and (
      latest.side <> 'seller' or latest.amount is distinct from o.counter_amount
    )) or (o.status = 'accepted' and latest.amount is distinct from o.amount);

  select count(*) into v_offer_financial from public.offers o
  where o.status in ('submitted', 'countered', 'accepted')
    and (
      o.amount < 0.01 or o.amount > 100000000000 or round(o.amount, 2) <> o.amount
      or (o.status = 'countered' and (
        o.counter_amount is null or o.counter_amount < 0.01
        or o.counter_amount > 100000000000
        or round(o.counter_amount, 2) <> o.counter_amount
      ))
      or exists (
        select 1 from lateral (
          select r.amount from public.offer_rounds r
          where r.offer_id = o.id order by r.round_no desc limit 1
        ) latest
        where latest.amount < 0.01 or latest.amount > 100000000000
          or round(latest.amount, 2) <> latest.amount
      )
    );

  select count(*) into v_non_won_commission from public.commissions c
  join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
  where d.stage <> 'won';

  if v_won_property_status + v_won_commission + v_duplicate_closure
     + v_won_financial + v_won_asset
     + v_rental_property + v_rental_prev + v_duplicate_rental
     + v_rental_deal + v_rental_commission
     + v_unit_deal + v_unit_commission + v_project_unit_deal
     + v_accepted_history + v_counter_history + v_counter_amount
     + v_offer_financial + v_non_won_commission > 0 then
    raise exception '%', format(
      'Core workflow reconciliation required: won_property_status=%s, won_missing_commission=%s, duplicate_closure=%s, won_financial=%s, won_missing_asset=%s, rental_property=%s, rental_prev=%s, duplicate_rental=%s, rental_deal=%s, rental_commission=%s, sold_unit_deal=%s, sold_unit_commission=%s, project_unit_deal=%s, offer_initial_history=%s, countered_offer_history=%s, offer_projection=%s, offer_financial=%s, non_won_commission=%s',
      v_won_property_status, v_won_commission, v_duplicate_closure,
      v_won_financial, v_won_asset,
      v_rental_property, v_rental_prev, v_duplicate_rental,
      v_rental_deal, v_rental_commission,
      v_unit_deal, v_unit_commission, v_project_unit_deal,
      v_accepted_history, v_counter_history, v_counter_amount,
      v_offer_financial, v_non_won_commission
    ) using errcode = 'P0001';
  end if;
end;
$$;

do $$
begin
  update public.deals d
  set closure_active = true
  from public.properties p
  where d.property_id = p.id and d.tenant_id = p.tenant_id
    and d.stage = 'won' and p.status in ('sold', 'rented')
    and d.closure_active = false;
  if exists (
    select 1 from public.deals
    where closure_active = true and property_id is not null
    group by tenant_id, property_id having count(*) > 1
  ) then
    raise exception
      'Cannot enforce won-deal invariant: duplicate won deals exist for a property. Reconcile them before applying this migration.';
  end if;
  if exists (
    select 1 from public.rentals
    where status = 'active'
    group by tenant_id, property_id having count(*) > 1
  ) then
    raise exception
      'Cannot enforce active-rental invariant: duplicate active rentals exist for a property. Reconcile them before applying this migration.';
  end if;
end;
$$;

create unique index if not exists uq_deals_tenant_property_won
  on public.deals (tenant_id, property_id)
  where stage = 'won' and closure_active = true and property_id is not null;

create unique index if not exists uq_rentals_tenant_property_active
  on public.rentals (tenant_id, property_id)
  where status = 'active';

create or replace function public.guard_deal_atomic_stage()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' and new.stage::text in ('won', 'lost') then
    raise exception 'Terminal deal stages require the atomic workflow.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.stage is distinct from old.stage
    or new.closure_active is distinct from old.closure_active
  ) then
    raise exception 'Deal stage changes require the atomic workflow.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
     and (old.stage::text = 'won' or new.stage::text = 'won')
     and (
       new.tenant_id is distinct from old.tenant_id
       or new.property_id is distinct from old.property_id
       or new.customer_id is distinct from old.customer_id
       or new.deal_type is distinct from old.deal_type
       or new.deal_value is distinct from old.deal_value
       or new.assigned_to is distinct from old.assigned_to
       or new.project_unit_id is distinct from old.project_unit_id
       or new.prev_property_status is distinct from old.prev_property_status
       or new.probability is distinct from old.probability
       or new.loss_reason is distinct from old.loss_reason
     ) then
    raise exception 'Won deal business fields are immutable outside the atomic workflow.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and old.stage::text = 'won' then
    raise exception 'Won deals cannot bypass the atomic rollback workflow.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists deals_guard_atomic_stage on public.deals;
create trigger deals_guard_atomic_stage
before insert or update of stage, closure_active, tenant_id, property_id, customer_id,
  deal_type, deal_value, assigned_to, project_unit_id, prev_property_status,
  probability, loss_reason or delete on public.deals
for each row execute function public.guard_deal_atomic_stage();

create or replace function public.guard_rental_atomic_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Rental creation requires the atomic workflow.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    raise exception 'Rental status changes require the atomic workflow.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Rental deletion requires a lifecycle workflow.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists rentals_guard_atomic_lifecycle on public.rentals;
create trigger rentals_guard_atomic_lifecycle
before insert or update of status or delete on public.rentals
for each row execute function public.guard_rental_atomic_lifecycle();

revoke all on function public.guard_deal_atomic_stage() from public, anon, authenticated;
revoke all on function public.guard_rental_atomic_lifecycle() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Direct-client state and child-ledger boundaries.
-- ---------------------------------------------------------------------------
create or replace function public.guard_property_terminal_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if new.status in ('sold', 'rented')
     or (tg_op = 'UPDATE' and old.status in ('sold', 'rented')) then
    raise exception 'Sold/rented property states require the atomic deal or rental workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists properties_guard_terminal_status on public.properties;
create trigger properties_guard_terminal_status
before insert or update of status on public.properties
for each row execute function public.guard_property_terminal_status();

create or replace function public.record_property_status_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_reason text;
begin
  if new.status is not distinct from old.status then return new; end if;
  begin
    v_actor := nullif(current_setting('app.property_status_actor', true), '')::uuid;
  exception when invalid_text_representation then
    v_actor := null;
  end;
  v_reason := nullif(current_setting('app.property_status_reason', true), '');
  if v_actor is null and auth.role() = 'authenticated' then v_actor := auth.uid(); end if;
  insert into public.property_status_history (
    property_id, tenant_id, old_status, new_status, reason, changed_by
  ) values (new.id, new.tenant_id, old.status, new.status, v_reason, v_actor);
  return new;
end;
$$;

drop trigger if exists properties_record_status_history on public.properties;
create trigger properties_record_status_history
after update of status on public.properties
for each row execute function public.record_property_status_history();

create or replace function public.guard_offer_atomic_state()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if new.status is distinct from old.status
     or new.deal_id is distinct from old.deal_id
     or new.amount is distinct from old.amount
     or new.counter_amount is distinct from old.counter_amount
     or new.submitted_at is distinct from old.submitted_at
     or new.responded_at is distinct from old.responded_at then
    raise exception 'Offer state and financial terms require the atomic workflow.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists offers_guard_atomic_state on public.offers;
create trigger offers_guard_atomic_state
before update of status, deal_id, amount, counter_amount, submitted_at, responded_at
on public.offers for each row execute function public.guard_offer_atomic_state();

create or replace function public.guard_contract_atomic_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' and (
    new.status::text <> 'draft' or new.signed_at is not null or new.cancelled_at is not null
  ) then
    raise exception 'Contracts must begin as unsigned drafts.' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Contract mutations require the atomic lifecycle.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists contracts_guard_atomic_lifecycle on public.contracts;
create trigger contracts_guard_atomic_lifecycle
before insert or update or delete on public.contracts
for each row execute function public.guard_contract_atomic_lifecycle();

create or replace function public.guard_portal_listing_atomic_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'authenticated' then
    raise exception 'Portal listing mutations require an authorized server workflow.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists portal_listings_guard_atomic_mutation on public.portal_listings;
create trigger portal_listings_guard_atomic_mutation
before insert or update or delete on public.portal_listings
for each row execute function public.guard_portal_listing_atomic_mutation();

create or replace function public.guard_project_unit_sale_state()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if (tg_op = 'INSERT' and (
       new.status = 'sold' or new.sold_at is not null
     )) or (tg_op = 'UPDATE' and (
       old.status = 'sold' or new.status = 'sold'
       or new.sold_at is distinct from old.sold_at
       or (old.status = 'sold' and (
         new.tenant_id is distinct from old.tenant_id
         or new.project_id is distinct from old.project_id
         or new.customer_id is distinct from old.customer_id
         or new.list_price is distinct from old.list_price
       ))
     )) then
    raise exception 'Project unit sales require the atomic sale workflow.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists project_units_guard_sale_state on public.project_units;
create trigger project_units_guard_sale_state
before insert or update of status, sold_at, tenant_id, project_id, customer_id, list_price
on public.project_units
for each row execute function public.guard_project_unit_sale_state();

create or replace function public.guard_open_house_atomic_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if tg_table_name = 'open_house_visitors' then
    if (tg_op = 'INSERT' and new.created_customer_id is not null)
       or (tg_op = 'UPDATE' and new.created_customer_id is distinct from old.created_customer_id) then
      raise exception 'Visitor conversion requires the atomic workflow.' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status and not (
    (old.status = 'planned' and new.status in ('active', 'cancelled'))
    or (old.status = 'active' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception 'Invalid open-house status transition.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists open_houses_guard_status on public.open_houses;
create trigger open_houses_guard_status
before update of status on public.open_houses
for each row execute function public.guard_open_house_atomic_fields();
drop trigger if exists open_house_visitors_guard_customer on public.open_house_visitors;
create trigger open_house_visitors_guard_customer
before insert or update of created_customer_id on public.open_house_visitors
for each row execute function public.guard_open_house_atomic_fields();

create or replace function public.guard_commission_atomic_ledger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Commission creation requires an atomic closing workflow.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Commission deletion requires an atomic reopen workflow.' using errcode = '42501';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.deal_id is distinct from old.deal_id
     or new.gross_amount is distinct from old.gross_amount
     or new.vat_amount is distinct from old.vat_amount
     or new.created_at is distinct from old.created_at then
    raise exception 'Commission identity and financial totals are immutable outside the atomic workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists commissions_guard_atomic_ledger on public.commissions;
create trigger commissions_guard_atomic_ledger
before insert or update of tenant_id, deal_id, gross_amount, vat_amount, created_at or delete
on public.commissions for each row execute function public.guard_commission_atomic_ledger();

-- Remove every legacy permissive policy before installing the capability
-- policy for these child ledgers. Service role keeps full access and bypasses
-- RLS; authenticated users receive only the operations used by server actions.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'contract_signers', 'offer_rounds', 'listing_closures', 'contract_versions',
    'payment_links', 'deal_costs', 'deal_notes', 'deal_checklist_items',
    'rent_charges', 'maintenance_requests', 'targets', 'open_houses',
    'open_house_visitors', 'property_status_history', 'project_units'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in select policyname from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end;
$$;

create policy workflow_contract_versions_select on public.contract_versions
for select to authenticated using (
  exists (select 1 from public.contracts c where c.id = contract_id
    and c.tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('contracts', 'view'))
);
create policy workflow_offer_rounds_select on public.offer_rounds
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('offers', 'view')
);
create policy workflow_listing_closures_select on public.listing_closures
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and (
    public.has_effective_permission('portals', 'view')
    or public.has_effective_permission('leak', 'view')
    or public.has_effective_permission('reports', 'view')
  )
);
create policy workflow_payment_links_select on public.payment_links
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'view')
);
create policy workflow_property_history_select on public.property_status_history
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'view')
);

create policy workflow_deal_costs_select on public.deal_costs
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'view'));
create policy workflow_deal_costs_insert on public.deal_costs
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'));
create policy workflow_deal_costs_update on public.deal_costs
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'));
create policy workflow_deal_costs_delete on public.deal_costs
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'));

create policy workflow_deal_notes_select on public.deal_notes
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'view'));
create policy workflow_deal_notes_insert on public.deal_notes
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and author_id = auth.uid() and public.has_effective_permission('commissions', 'edit'));
create policy workflow_deal_notes_delete on public.deal_notes
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and author_id = auth.uid() and public.has_effective_permission('commissions', 'edit'));

create policy workflow_deal_checklist_select on public.deal_checklist_items
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'view'));
create policy workflow_deal_checklist_insert on public.deal_checklist_items
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'));
create policy workflow_deal_checklist_update on public.deal_checklist_items
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'));
create policy workflow_deal_checklist_delete on public.deal_checklist_items
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('commissions', 'edit'));

create policy workflow_rent_charges_select on public.rent_charges
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'view'));
create policy workflow_rent_charges_insert on public.rent_charges
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'create'));
create policy workflow_rent_charges_update on public.rent_charges
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'edit'));
create policy workflow_rent_charges_delete on public.rent_charges
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'delete'));

create policy workflow_maintenance_select on public.maintenance_requests
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'view'));
create policy workflow_maintenance_insert on public.maintenance_requests
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'create'));
create policy workflow_maintenance_update on public.maintenance_requests
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'edit'));
create policy workflow_maintenance_delete on public.maintenance_requests
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('rentals', 'delete'));

create policy workflow_targets_select on public.targets
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('targets', 'view'));
create policy workflow_targets_insert on public.targets
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('targets', 'create'));
create policy workflow_targets_update on public.targets
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('targets', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('targets', 'edit'));
create policy workflow_targets_delete on public.targets
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('targets', 'delete'));

create policy workflow_open_houses_select on public.open_houses
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('open_house', 'view'));
create policy workflow_open_houses_insert on public.open_houses
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('open_house', 'create'));
create policy workflow_open_houses_update on public.open_houses
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('open_house', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('open_house', 'edit'));
create policy workflow_open_houses_delete on public.open_houses
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('open_house', 'delete'));

create policy workflow_open_house_visitors_select on public.open_house_visitors
for select to authenticated using (exists (
  select 1 from public.open_houses oh where oh.id = open_house_id
    and oh.tenant_id = public.current_active_tenant_id()
    and (public.has_effective_permission('open_house', 'view')
      or public.has_effective_permission('customers', 'create'))
));
create policy workflow_open_house_visitors_insert on public.open_house_visitors
for insert to authenticated with check (exists (
  select 1 from public.open_houses oh where oh.id = open_house_id
    and oh.tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('open_house', 'create')
));
create policy workflow_open_house_visitors_update on public.open_house_visitors
for update to authenticated using (exists (
  select 1 from public.open_houses oh where oh.id = open_house_id
    and oh.tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('open_house', 'edit')
)) with check (exists (
  select 1 from public.open_houses oh where oh.id = open_house_id
    and oh.tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('open_house', 'edit')
));
create policy workflow_open_house_visitors_delete on public.open_house_visitors
for delete to authenticated using (exists (
  select 1 from public.open_houses oh where oh.id = open_house_id
    and oh.tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('open_house', 'delete')
));

create policy workflow_project_units_select on public.project_units
for select to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('projects', 'view'));
create policy workflow_project_units_insert on public.project_units
for insert to authenticated with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('projects', 'create'));
create policy workflow_project_units_update on public.project_units
for update to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('projects', 'edit'))
with check (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('projects', 'edit'));
create policy workflow_project_units_delete on public.project_units
for delete to authenticated using (tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('projects', 'delete'));

revoke all privileges on public.contract_signers from authenticated;
revoke insert, update, delete on public.offer_rounds from authenticated;
revoke insert, update, delete on public.listing_closures from authenticated;
revoke insert, update, delete on public.contract_versions from authenticated;
revoke insert, update, delete on public.payment_links from authenticated;
revoke insert, update, delete on public.property_status_history from authenticated;
revoke insert, update, delete on public.offers from authenticated;
revoke update on public.rentals from authenticated;
revoke update, delete on public.contracts from authenticated;
revoke insert, update, delete on public.portal_listings from authenticated;
revoke insert, delete on public.commissions from authenticated;

revoke all on function public.guard_property_terminal_status() from public, anon, authenticated;
revoke all on function public.record_property_status_history() from public, anon, authenticated;
revoke all on function public.guard_offer_atomic_state() from public, anon, authenticated;
revoke all on function public.guard_contract_atomic_lifecycle() from public, anon, authenticated;
revoke all on function public.guard_portal_listing_atomic_mutation() from public, anon, authenticated;
revoke all on function public.guard_open_house_atomic_fields() from public, anon, authenticated;
revoke all on function public.guard_project_unit_sale_state() from public, anon, authenticated;
revoke all on function public.guard_commission_atomic_ledger() from public, anon, authenticated;
