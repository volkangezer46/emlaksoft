-- e-Fatura: saglayici SONUCUNU yazan RPC'ler yalniz sunucuya (service_role) acilir.
-- Acik: commissions.create yetkisi olan kullanici PostgREST'ten einvoice_mark_issued vb. cagirip sahte "issued" yazabiliyordu.
-- Cozum: eski 5 RPC'nin (record_progress, mark_issued, record_status, mark_cancelled, recover_issue_mine) EXECUTE'u
-- herkesten alinir; ayni isi yapan *_srv RPC'leri YALNIZ service_role'e verilir. Eylem (src/app/actions/einvoice.ts)
-- kullanici iznini (requirePermission commissions.create) ve ofis eslesmesini kendisi dogrular, sonra admin client ile cagirir;
-- ofis p_tenant ile gelir ve her UPDATE tenant_id ile sinirlidir. Kullanici RPC'leri (taslak, talep, isaret, reopen, silme) degismez.

create or replace function public.einvoice_srv_record_progress(
  p_tenant uuid, p_actor uuid, p_id uuid, p_ref jsonb default null, p_number text default null, p_error text default null, p_release boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if p_tenant is null then
    raise exception 'Ofis gerekli.' using errcode = '42501';
  end if;
  update public.einvoices set
    provider_ref = coalesce(p_ref, provider_ref),
    number = coalesce(p_number, number),
    error = case when p_error is not null then left(p_error, 500) else error end,
    issue_claimed_at = case when p_release then null else issue_claimed_at end,
    issue_stage = case when p_release then null else issue_stage end
  where id = p_id and tenant_id = p_tenant and status = 'draft';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_srv_mark_issued(p_tenant uuid, p_actor uuid, p_id uuid, p_ref jsonb, p_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if p_tenant is null then
    raise exception 'Ofis gerekli.' using errcode = '42501';
  end if;
  update public.einvoices set
    status = 'issued', provider_state = 'waiting',
    provider_ref = coalesce(p_ref, provider_ref), number = coalesce(p_number, number),
    error = null, issued_at = now(), issue_claimed_at = null, issue_stage = null
  where id = p_id and tenant_id = p_tenant and status = 'draft';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_tenant, p_actor, 'einvoice.issue', 'einvoice', p_id, null, jsonb_build_object('number', p_number));
  end if;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_srv_record_status(
  p_tenant uuid, p_actor uuid, p_id uuid, p_status text, p_provider_state text, p_number text, p_error text, p_ref jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if p_tenant is null then
    raise exception 'Ofis gerekli.' using errcode = '42501';
  end if;
  if p_status not in ('issued', 'error', 'cancelled') then
    raise exception 'Gecersiz durum.' using errcode = 'check_violation';
  end if;
  update public.einvoices set
    status = p_status, provider_state = p_provider_state,
    number = coalesce(p_number, number), error = case when p_error is null then null else left(p_error, 500) end,
    provider_ref = coalesce(p_ref, provider_ref), last_checked_at = now()
  where id = p_id and tenant_id = p_tenant and status = 'issued';
  get diagnostics v_rows = row_count;
  if v_rows = 1 and p_status <> 'issued' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_tenant, p_actor, 'einvoice.status_' || p_status, 'einvoice', p_id, null, null);
  end if;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_srv_mark_cancelled(p_tenant uuid, p_actor uuid, p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if p_tenant is null then
    raise exception 'Ofis gerekli.' using errcode = '42501';
  end if;
  update public.einvoices set status = 'cancelled', error = null
   where id = p_id and tenant_id = p_tenant and status = 'issued';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_tenant, p_actor, 'einvoice.cancel', 'einvoice', p_id, null, jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
  end if;
  return v_rows = 1;
end;
$$;

-- Kurtarma (Durumu yenile): ofis p_tenant ile gelir; mevcut uygulayici govde yeniden kullanilir.
create or replace function public.einvoice_srv_recover_issue(p_tenant uuid, p_id uuid, p_outcome text, p_ref jsonb, p_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant is null then
    raise exception 'Ofis gerekli.' using errcode = '42501';
  end if;
  return public._einvoice_recover_apply(p_tenant, p_id, p_outcome, p_ref, p_number);
end;
$$;

-- Yetkiler: yeni *_srv yalniz service_role; eski sonuc-yazan RPC'ler herkesten alinir.
revoke all on function public.einvoice_srv_record_progress(uuid, uuid, uuid, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.einvoice_srv_mark_issued(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.einvoice_srv_record_status(uuid, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.einvoice_srv_mark_cancelled(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.einvoice_srv_recover_issue(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.einvoice_srv_record_progress(uuid, uuid, uuid, jsonb, text, text, boolean) to service_role;
grant execute on function public.einvoice_srv_mark_issued(uuid, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.einvoice_srv_record_status(uuid, uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.einvoice_srv_mark_cancelled(uuid, uuid, uuid, text) to service_role;
grant execute on function public.einvoice_srv_recover_issue(uuid, uuid, text, jsonb, text) to service_role;

revoke all on function public.einvoice_record_progress(uuid, jsonb, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.einvoice_mark_issued(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.einvoice_record_status(uuid, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.einvoice_mark_cancelled(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.einvoice_recover_issue_mine(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
