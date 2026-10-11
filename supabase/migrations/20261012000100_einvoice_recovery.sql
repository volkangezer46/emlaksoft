-- e-Fatura belirsiz sonuc kurtarma (Konsey Tur 3 #20 + #41).
--
-- NEDEN: resmilestirme istegi saglayiciya gitti ama yanit alinamadi (zaman asimi/5xx) -> satir 'draft' + issue_claimed_at
--   kilidinde takili kaliyor; kilit 5 dk sonra acilinca ikinci bir ConfirmAndSend = iki resmi fatura riski.
-- NE: (1) einvoices.issue_stage ('issue_sent'): saglayiciya resmilestirme istegi GITMEDEN ONCE yazilir; yalniz kesin ret
--         (release) ya da kurtarma sonucu temizlenir. issue_stage dolu satir yeniden talep EDILEMEZ/duzenlenemez/silinemez.
--     (2) einvoice_mark_issue_sent(id): action'in istekten once koydugu isaret (kapili, commissions.create).
--     (3) Kurtarma uygulayici: _einvoice_recover_apply (kapali) + einvoice_recover_issue_mine (kullanici, kapili) +
--         einvoice_recover_issue (YALNIZ service_role; otomasyon cron). Sonuc 'sent' -> issued/waiting; 'not_sent' (saglayicida
--         belge YOK, kanitli) -> kilit ve isaret temizlenir. Yalniz kilit suresi (5 dk) dolduktan sonra uygulanir.
--         Hicbir kurtarma yolu ikinci resmilestirme YAPMAZ; yeniden deneme yalnizca kullanicinin acik eylemidir.
--     (4) Ilerleme/serbest birakma/resmilestirme/yeniden acma isaret temizligi ile yeniden tanimlanir (govde 20261011000600 baz).
--     (5) Kullanici RPC'lerinden service_role EXECUTE kalkar (kapi auth.uid ister; cron bunlari zaten cagirmaz).
--         authenticated EXECUTE KALIR: server action bunlari kullanici oturumuyla cagirir; her biri _einvoice_gate ile
--         commissions.create + ofis denetler.
-- GERI ALMA: supabase/rollbacks/20261012000100_einvoice_recovery.rollback.sql
-- RISK: dusuk (ek sutun + 4 yeni fonksiyon; 6 fonksiyon ayni imzayla yeniden tanimlanir).

set local lock_timeout = '5s';
set local search_path = public;

alter table public.einvoices add column if not exists issue_stage text;
alter table public.einvoices drop constraint if exists einvoices_issue_stage_check;
alter table public.einvoices add constraint einvoices_issue_stage_check check (issue_stage is null or issue_stage = 'issue_sent');

-- Kurtarma tarayicisi icin kismi indeks (yalniz belirsiz satirlar)
create index if not exists einvoices_issue_stage_idx on public.einvoices (issue_claimed_at) where issue_stage is not null;

-- ---------------------------------------------------------------------------
-- Taslak kaydet: belirsiz (issue_stage dolu) satir duzenlenemez
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
  if v_row.issue_stage is not null then
    raise exception 'Resmilestirme sonucu dogrulaniyor.' using errcode = 'lock_not_available';
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
-- Talep: belirsiz satir (issue_stage dolu) yeniden talep edilemez
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
       and e.issue_stage is null
       and (e.issue_claimed_at is null or e.issue_claimed_at < now() - interval '5 minutes')
    returning e.*;
  if found then
    perform public._einvoice_audit(v_tenant, 'einvoice.issue_claim', p_id, null, null);
  end if;
end;
$$;

-- Isaret: resmilestirme istegi saglayiciya gitmeden HEMEN once (talep sahibi; saglayici kimligi var).
create or replace function public.einvoice_mark_issue_sent(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
  v_rows int;
begin
  update public.einvoices set issue_stage = 'issue_sent', issue_claimed_at = now()
   where id = p_id and tenant_id = v_tenant and status = 'draft'
     and issue_stage is null and issue_claimed_at is not null
     and provider_ref <> '{}'::jsonb;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.issue_sent', p_id, null, null);
  end if;
  return v_rows = 1;
end;
$$;

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
    issue_claimed_at = case when p_release then null else issue_claimed_at end,
    issue_stage = case when p_release then null else issue_stage end
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
    error = null, issued_at = now(), issue_claimed_at = null, issue_stage = null
  where id = p_id and tenant_id = v_tenant and status = 'draft';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.issue', p_id, null, jsonb_build_object('number', p_number));
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
    external_id = gen_random_uuid(), error = null, issued_at = null, issue_claimed_at = null, issue_stage = null
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
     and issue_stage is null
     and (issue_claimed_at is null or issue_claimed_at < now() - interval '5 minutes');
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform public._einvoice_audit(v_tenant, 'einvoice.draft_delete', p_id, null, null);
  end if;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kurtarma uygulayici (ortak govde; disariya acik DEGIL)
--   p_outcome 'sent'     : saglayicida belge VAR -> issued/waiting (nihai durumu mevcut durum senkronu isler)
--   p_outcome 'not_sent' : saglayicida belge YOK (kanitli) -> kilit+isaret temizlenir; kullanici isterse yeniden dener
-- Yalniz: draft + issue_stage dolu + kilit suresi (5 dk) dolmus. Aksi halde false (hicbir sey degismez).
-- ---------------------------------------------------------------------------
create or replace function public._einvoice_recover_apply(
  p_tenant uuid, p_id uuid, p_outcome text, p_ref jsonb, p_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if p_outcome not in ('sent', 'not_sent') then
    raise exception 'Gecersiz kurtarma sonucu.' using errcode = 'check_violation';
  end if;
  if p_outcome = 'sent' then
    update public.einvoices set
      status = 'issued', provider_state = 'waiting',
      provider_ref = coalesce(p_ref, provider_ref), number = coalesce(p_number, number),
      error = null, issued_at = now(), issue_claimed_at = null, issue_stage = null
    where id = p_id and tenant_id = p_tenant and status = 'draft'
      and issue_stage = 'issue_sent' and issue_claimed_at < now() - interval '5 minutes';
  else
    update public.einvoices set
      error = 'Onceki resmilestirme denemesinde saglayicida belge olusmadigi dogrulandi; yeniden deneyebilirsiniz.',
      issue_claimed_at = null, issue_stage = null
    where id = p_id and tenant_id = p_tenant and status = 'draft'
      and issue_stage = 'issue_sent' and issue_claimed_at < now() - interval '5 minutes';
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (p_tenant, (select auth.uid()), 'einvoice.recover_' || p_outcome, 'einvoice', p_id, null,
            jsonb_build_object('number', p_number));
  end if;
  return v_rows = 1;
end;
$$;

-- Kullanici yolu ("Durumu yenile"): kapi + ofis denetimi.
create or replace function public.einvoice_recover_issue_mine(p_id uuid, p_outcome text, p_ref jsonb, p_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public._einvoice_gate();
begin
  return public._einvoice_recover_apply(v_tenant, p_id, p_outcome, p_ref, p_number);
end;
$$;

-- Cron yolu (otomasyon): YALNIZ service_role; ofis satirdan okunur.
create or replace function public.einvoice_recover_issue(p_id uuid, p_outcome text, p_ref jsonb, p_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.einvoices where id = p_id;
  if v_tenant is null then
    return false;
  end if;
  return public._einvoice_recover_apply(v_tenant, p_id, p_outcome, p_ref, p_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
revoke all on function public._einvoice_recover_apply(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.einvoice_mark_issue_sent(uuid) from public, anon, service_role;
revoke all on function public.einvoice_recover_issue_mine(uuid, text, jsonb, text) from public, anon, service_role;
revoke all on function public.einvoice_recover_issue(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.einvoice_mark_issue_sent(uuid) to authenticated;
grant execute on function public.einvoice_recover_issue_mine(uuid, text, jsonb, text) to authenticated;
grant execute on function public.einvoice_recover_issue(uuid, text, jsonb, text) to service_role;

-- Kullanici RPC'leri: service_role EXECUTE gereksiz (kapi auth.uid() ister; cron dogrudan tablo/yeni RPC kullanir).
revoke execute on function public.einvoice_save_draft(uuid, jsonb) from service_role;
revoke execute on function public.einvoice_claim_issue(uuid) from service_role;
revoke execute on function public.einvoice_record_progress(uuid, jsonb, text, text, boolean) from service_role;
revoke execute on function public.einvoice_mark_issued(uuid, jsonb, text) from service_role;
revoke execute on function public.einvoice_record_status(uuid, text, text, text, text, jsonb) from service_role;
revoke execute on function public.einvoice_mark_cancelled(uuid, text) from service_role;
revoke execute on function public.einvoice_reopen(uuid) from service_role;
revoke execute on function public.einvoice_delete_draft(uuid) from service_role;

notify pgrst, 'reload schema';
