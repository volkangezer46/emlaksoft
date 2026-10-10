-- e-Fatura butunlugu (Konsey 2026-10-11, P2 / #52 + #23): durum makinesi + atomik resmilestirme talebi.
--
-- NEDEN: einvoices uzerinde authenticated dogrudan UPDATE/DELETE/INSERT yapabiliyordu; durum gecisleri denetimsizdi
--   (issued -> draft gibi geri donusler, iki istegin ayni taslagi ayni anda resmilestirmesi = saglayicida cift fatura).
-- NE: (1) einvoices.issue_claimed_at (5 dk kilit) sutunu.
--     (2) authenticated icin einvoices INSERT/UPDATE/DELETE yetkisi KALDIRILIR; yazma yalniz asagidaki SECURITY DEFINER
--         RPC'lerle (search_path=''; ofis = current_active_tenant_id(); izin = commissions.create; audit_logs kaydi):
--         einvoice_save_draft, einvoice_claim_issue (atomik talep), einvoice_record_progress, einvoice_mark_issued,
--         einvoice_record_status, einvoice_mark_cancelled, einvoice_reopen, einvoice_delete_draft.
--     (3) einvoices_guard durum matrisi: draft->issued|error, issued->error|cancelled, error->draft; issued->draft YASAK;
--         cancelled kalici. Ayni durumda kalan guncellemeler (ornegin last_checked_at) serbest.
--     (4) Silme yalniz taslak + provider_ref bos (RPC ve politika).
-- KRON: service_role (otomasyon durum senkronu) tablo yetkisini korur; tetikleyici ona da uygulanir.
-- GERI ALMA: supabase/rollbacks/20261011000600_einvoice_state_machine.rollback.sql
-- RISK: orta (yazma yolu RPC'ye tasinir); RPC yokken kod yazamaz (guvenli tarafta hata verir).

set local lock_timeout = '5s';
set local search_path = public;

alter table public.einvoices add column if not exists issue_claimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1) Durum matrisi (guard)
-- ---------------------------------------------------------------------------
create or replace function public.einvoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'cancelled' then
      raise exception 'Iptal edilmis fatura degistirilemez.' using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status then
      if not (
           (old.status = 'draft'  and new.status in ('issued', 'error'))
        or (old.status = 'issued' and new.status in ('error', 'cancelled'))
        or (old.status = 'error'  and new.status = 'draft')
      ) then
        raise exception 'Gecersiz fatura durum gecisi: % -> %.', old.status, new.status using errcode = 'check_violation';
      end if;
    end if;
    if old.status = 'issued' and (
         new.lines is distinct from old.lines
      or new.buyer_name is distinct from old.buyer_name
      or new.buyer_tax_id is distinct from old.buyer_tax_id
      or new.net_total is distinct from old.net_total
      or new.vat_total is distinct from old.vat_total
      or new.gross_total is distinct from old.gross_total
      or new.issue_date is distinct from old.issue_date
      or new.doc_type is distinct from old.doc_type
      or new.source_type is distinct from old.source_type
      or new.source_id is distinct from old.source_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.external_id is distinct from old.external_id
      or new.tenant_id is distinct from old.tenant_id
    ) then
      raise exception 'Resmilesmis faturanin icerigi degistirilemez.' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Silme politikasi: yalniz taslak ve saglayicida henuz bir sey olusmamis (provider_ref bos).
drop policy if exists einvoices_delete on public.einvoices;
create policy einvoices_delete on public.einvoices
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and status = 'draft'
    and provider_ref = '{}'::jsonb
    and (select public.has_effective_permission('commissions', 'create'))
  );

-- ---------------------------------------------------------------------------
-- 2) Ortak kapi (DEFINER govdelerinden cagrilir; disariya acik DEGIL)
-- ---------------------------------------------------------------------------
create or replace function public._einvoice_gate()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select public.current_active_tenant_id());
begin
  if v_tenant is null or (select auth.uid()) is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if not (select public.has_effective_permission('commissions', 'create')) then
    raise exception 'Bu islem icin yetkiniz yok.' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

create or replace function public._einvoice_audit(p_tenant uuid, p_action text, p_id uuid, p_old jsonb, p_new jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_tenant, (select auth.uid()), p_action, 'einvoice', p_id, p_old, p_new);
$$;

revoke all on function public._einvoice_gate() from public, anon, authenticated;
revoke all on function public._einvoice_audit(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Taslak kaydet (yeni ya da duzenleme)
-- ---------------------------------------------------------------------------
create or replace function public.einvoice_save_draft(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_row public.einvoices;
  v_id uuid;
begin
  if p_id is null then
    insert into public.einvoices (
      tenant_id, connection_id, provider, mode, source_type, source_id, source_label, doc_type,
      buyer_name, buyer_tax_id, buyer_tax_office, buyer_address, buyer_city, buyer_district, buyer_alias,
      lines, net_total, vat_total, gross_total, issue_date, note, idempotency_key, created_by
    ) values (
      v_tenant, nullif(p ->> 'connection_id', '')::uuid, p ->> 'provider', coalesce(p ->> 'mode', 'live'),
      p ->> 'source_type', nullif(p ->> 'source_id', '')::uuid, p ->> 'source_label', p ->> 'doc_type',
      p ->> 'buyer_name', p ->> 'buyer_tax_id', p ->> 'buyer_tax_office', p ->> 'buyer_address',
      p ->> 'buyer_city', p ->> 'buyer_district', p ->> 'buyer_alias',
      p -> 'lines', (p ->> 'net_total')::numeric, (p ->> 'vat_total')::numeric, (p ->> 'gross_total')::numeric,
      (p ->> 'issue_date')::date, p ->> 'note', p ->> 'idempotency_key', (select auth.uid())
    ) returning id into v_id;
    perform public._einvoice_audit(v_tenant, 'einvoice.draft_create', v_id, null,
      jsonb_build_object('source_type', p ->> 'source_type', 'gross_total', p -> 'gross_total'));
    return v_id;
  end if;

  select * into v_row from public.einvoices where id = p_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Taslak bulunamadi.' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Yalniz taslak fatura duzenlenebilir.' using errcode = 'check_violation';
  end if;
  if v_row.issue_claimed_at is not null and v_row.issue_claimed_at > now() - interval '5 minutes' then
    raise exception 'Islem suruyor.' using errcode = 'lock_not_available';
  end if;
  update public.einvoices set
    connection_id = nullif(p ->> 'connection_id', '')::uuid,
    provider = p ->> 'provider',
    mode = coalesce(p ->> 'mode', 'live'),
    source_label = p ->> 'source_label',
    doc_type = p ->> 'doc_type',
    buyer_name = p ->> 'buyer_name',
    buyer_tax_id = p ->> 'buyer_tax_id',
    buyer_tax_office = p ->> 'buyer_tax_office',
    buyer_address = p ->> 'buyer_address',
    buyer_city = p ->> 'buyer_city',
    buyer_district = p ->> 'buyer_district',
    buyer_alias = p ->> 'buyer_alias',
    lines = p -> 'lines',
    net_total = (p ->> 'net_total')::numeric,
    vat_total = (p ->> 'vat_total')::numeric,
    gross_total = (p ->> 'gross_total')::numeric,
    issue_date = (p ->> 'issue_date')::date,
    note = p ->> 'note',
    error = null,
    provider_ref = '{}'::jsonb,
    issue_claimed_at = null
  where id = p_id;
  perform public._einvoice_audit(v_tenant, 'einvoice.draft_update', p_id, null,
    jsonb_build_object('gross_total', p -> 'gross_total'));
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Atomik resmilestirme talebi (5 dk kilit). Satir donmezse baska bir istek surdurmektedir.
-- ---------------------------------------------------------------------------
create or replace function public.einvoice_claim_issue(p_id uuid)
returns setof public.einvoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
begin
  return query
    update public.einvoices e
       set issue_claimed_at = now()
     where e.id = p_id
       and e.tenant_id = v_tenant
       and e.status = 'draft'
       and (e.issue_claimed_at is null or e.issue_claimed_at < now() - interval '5 minutes')
    returning e.*;
  if found then
    perform public._einvoice_audit(v_tenant, 'einvoice.issue_claim', p_id, null, null);
  end if;
end;
$$;

-- Talep sahibi: saglayici ilerlemesi (provider_ref/number) ya da hata; p_release kilidi birakir.
create or replace function public.einvoice_record_progress(
  p_id uuid, p_ref jsonb default null, p_number text default null, p_error text default null, p_release boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  update public.einvoices set
    provider_ref = coalesce(p_ref, provider_ref),
    number = coalesce(p_number, number),
    error = case when p_error is not null then left(p_error, 500) else error end,
    issue_claimed_at = case when p_release then null else issue_claimed_at end
  where id = p_id and tenant_id = v_tenant and status = 'draft';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_mark_issued(p_id uuid, p_ref jsonb, p_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  update public.einvoices set
    status = 'issued', provider_state = 'waiting',
    provider_ref = coalesce(p_ref, provider_ref), number = coalesce(p_number, number),
    error = null, issued_at = now(), issue_claimed_at = null
  where id = p_id and tenant_id = v_tenant and status = 'draft';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.issue', p_id, null, jsonb_build_object('number', p_number));
  end if;
  return v_rows = 1;
end;
$$;

-- Durum yenile: yalniz resmilesmis (issued) satir; gecisler tetikleyicide denetlenir.
create or replace function public.einvoice_record_status(
  p_id uuid, p_status text, p_provider_state text, p_number text, p_error text, p_ref jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  if p_status not in ('issued', 'error', 'cancelled') then
    raise exception 'Gecersiz durum.' using errcode = 'check_violation';
  end if;
  update public.einvoices set
    status = p_status, provider_state = p_provider_state,
    number = coalesce(p_number, number), error = case when p_error is null then null else left(p_error, 500) end,
    provider_ref = coalesce(p_ref, provider_ref), last_checked_at = now()
  where id = p_id and tenant_id = v_tenant and status = 'issued';
  get diagnostics v_rows = row_count;
  if v_rows = 1 and p_status <> 'issued' then
    perform public._einvoice_audit(v_tenant, 'einvoice.status_' || p_status, p_id, null, null);
  end if;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_mark_cancelled(p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  update public.einvoices set status = 'cancelled', error = null
   where id = p_id and tenant_id = v_tenant and status = 'issued';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.cancel', p_id, null, jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
  end if;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_reopen(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  update public.einvoices set
    status = 'draft', provider_state = 'none', provider_ref = '{}'::jsonb,
    external_id = gen_random_uuid(), error = null, issued_at = null, issue_claimed_at = null
  where id = p_id and tenant_id = v_tenant and status = 'error';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.reopen', p_id, null, null);
  end if;
  return v_rows = 1;
end;
$$;

create or replace function public.einvoice_delete_draft(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  delete from public.einvoices
   where id = p_id and tenant_id = v_tenant and status = 'draft' and provider_ref = '{}'::jsonb
     and (issue_claimed_at is null or issue_claimed_at < now() - interval '5 minutes');
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.draft_delete', p_id, null, null);
  end if;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Yetkiler: dogrudan yazma kapanir, RPC acilir
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.einvoices from authenticated;

revoke all on function public.einvoice_save_draft(uuid, jsonb) from public, anon;
revoke all on function public.einvoice_claim_issue(uuid) from public, anon;
revoke all on function public.einvoice_record_progress(uuid, jsonb, text, text, boolean) from public, anon;
revoke all on function public.einvoice_mark_issued(uuid, jsonb, text) from public, anon;
revoke all on function public.einvoice_record_status(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.einvoice_mark_cancelled(uuid, text) from public, anon;
revoke all on function public.einvoice_reopen(uuid) from public, anon;
revoke all on function public.einvoice_delete_draft(uuid) from public, anon;
grant execute on function public.einvoice_save_draft(uuid, jsonb) to authenticated, service_role;
grant execute on function public.einvoice_claim_issue(uuid) to authenticated, service_role;
grant execute on function public.einvoice_record_progress(uuid, jsonb, text, text, boolean) to authenticated, service_role;
grant execute on function public.einvoice_mark_issued(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.einvoice_record_status(uuid, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.einvoice_mark_cancelled(uuid, text) to authenticated, service_role;
grant execute on function public.einvoice_reopen(uuid) to authenticated, service_role;
grant execute on function public.einvoice_delete_draft(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
