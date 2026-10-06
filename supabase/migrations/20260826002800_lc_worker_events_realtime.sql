-- MIGRATION 20260826002800_lc_worker_events_realtime.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002800_lc_worker_events_realtime.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002800_lc_worker_events_realtime.rollback.sql
-- BAGIMLILIK: 20260826002020 (verification_clients/jobs/health), 20260826002030 (listing_anomalies),
--   20260826002040 (property_control_state), 20260826002050 (lc_claim_verification_jobs, lc_apply_check).
--
-- 1) TARAYICI DESTEKLI DOGRULAMA: kullanici JWT'siyle cagrilan 4 RPC (service_role GEREKTIRMEZ). Mevcut service_role
--    cekirdeklerini (lc_claim_verification_jobs / lc_apply_check) SARAR; ofis ve kullanici auth.uid()/JWT'den cikar,
--    yetki `portals/edit`. Ayni is iki cihaza verilmez (cekirdek FOR UPDATE SKIP LOCKED + lease), saatlik hiz siniri 60,
--    istemci basina en fazla 3 acik is, kullanici basina en fazla 5 cihaz. Ayni kullanicinin ikinci cihazi bagimsiz
--    SAYILMAZ (ayni kisi "yok" dediyse client_id null gecilir: sayac artar ama bagimsizlik artmaz).
--    Sonuc kaynagi 'assisted' (taban guven 0.70); blocked/error ASLA "yok" sayilmaz (cekirdek durum makinesi).
--    Portal sayfasi sunucudan CEKILMEZ: istemci yalniz kullanicinin kendi tarayicisinda gorunen fiyat/baslik/durumu bildirir.
-- 2) OLAY GUNLUGU listing_control_events: kontrol durumu degisimi, anomali acilis/durum, KPI bayragi degisimi.
--    Yalniz tetikleyicilerle (kendi tablolarimiz) yazilir; tuketici cron adimi + Realtime (ana ekran sayaclari).
--    RLS: lc_row_visible + portals/view -> Realtime olaylari da rol kapsamlidir (danisman yalniz kendi ilanini duyar).
-- 3) KAYIP-KACAK KALKANI ILE BIRLESIK AKIS (tek sistem, cift olcum yok):
--    a) listing_closures INSERT -> 'closure_recorded' olayi + portfoy durumu "bayat" (kapanis kaydi girilince 'potansiyel
--       kayip islem' / 'portal kayip' anomalisi cron'da ANINDA yeniden degerlendirilir ve kapanir; elle kapatma gerekmez).
--    b) dogrulama 'present' -> 'listing_confirmed' olayi: cron tuketicisi portal_listings.last_confirmed_at'i (Kalkan/portallar/
--       ana ekran teyit gecikmesi) ayni kaynaktan gunceller. portal_listings'e kullanici JWT'siyle yazim guard ile kapali
--       oldugundan yazim service_role cron'unda yapilir (yeni admin client YOK).
-- 4) lc_sync_anomalies yeniden tanimi: yeniden acma SOGUTMASI (cozulen alarm 24 saat, otomatik kapanan 2 saat icinde ayni
--    anahtarla yeniden ACILMAZ; dalgalanan durum alarm yagmuru uretmez). false_positive zaten hic yeniden acilmaz.
-- Etki: yeni tablo + yeni fonksiyonlar + 5 tetikleyici (4'u ilan kontrol tablolarinda, 1'i listing_closures INSERT'inde,
--   yalniz olay/bayat isareti yazar, hata yutulur) + lc_sync_anomalies govdesi. Mevcut tablo/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.verification_clients') is null
     or pg_catalog.to_regclass('public.listing_verification_jobs') is null
     or pg_catalog.to_regclass('public.portal_listing_health') is null
     or pg_catalog.to_regclass('public.listing_anomalies') is null
     or pg_catalog.to_regclass('public.property_control_state') is null
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_apply_check') then
    raise exception 'ilan kontrol tablolari/lc_apply_check yok; once 20260826002020..002050 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------- olay gunlugu
create table if not exists public.listing_control_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid,
  portal_listing_id uuid,
  branch_id uuid,
  team_id uuid,
  advisor_id uuid,
  event_type text not null check (event_type in
    ('check_state_changed', 'anomaly_opened', 'anomaly_status_changed', 'counters_changed', 'closure_recorded', 'listing_confirmed')),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 2048),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_lc_events_tenant on public.listing_control_events (tenant_id, created_at desc);
create index if not exists idx_lc_events_unprocessed on public.listing_control_events (created_at) where processed_at is null;

alter table public.listing_control_events enable row level security;
drop policy if exists listing_control_events_select on public.listing_control_events;
create policy listing_control_events_select on public.listing_control_events for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.lc_row_visible(branch_id, team_id, advisor_id))
);
revoke all on table public.listing_control_events from public, anon, authenticated;
grant select on table public.listing_control_events to authenticated;
grant all on table public.listing_control_events to service_role;

-- Tetikleyici fonksiyonlari: olay yazimi ASIL islemi ASLA bozmaz (hata yutulur).
create or replace function public.lc_emit_health_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.check_state <> 'unchecked') or (tg_op = 'UPDATE' and old.check_state is distinct from new.check_state) then
    begin
      insert into public.listing_control_events (tenant_id, property_id, portal_listing_id, branch_id, team_id, advisor_id, event_type, payload)
      values (new.tenant_id, new.property_id, new.portal_listing_id, new.branch_id, new.team_id, new.advisor_id, 'check_state_changed',
              jsonb_build_object('from', case when tg_op = 'UPDATE' then old.check_state end, 'to', new.check_state, 'confidence', new.confidence));
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

create or replace function public.lc_emit_anomaly_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    begin
      insert into public.listing_control_events (tenant_id, property_id, portal_listing_id, branch_id, team_id, advisor_id, event_type, payload)
      values (new.tenant_id, new.property_id, new.portal_listing_id, new.branch_id, new.team_id, new.advisor_id,
              case when tg_op = 'INSERT' then 'anomaly_opened' else 'anomaly_status_changed' end,
              jsonb_build_object('type', new.type, 'severity', new.severity, 'from', case when tg_op = 'UPDATE' then old.status end, 'to', new.status));
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

create or replace function public.lc_emit_counters_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_sample then
    return null;
  end if;
  if tg_op = 'INSERT'
     or (old.k_active, old.k_in_portals, old.k_awaiting_publish, old.k_portal_missing, old.k_price_mismatch, old.k_in_review, old.k_unverifiable, old.k_healthy)
        is distinct from
        (new.k_active, new.k_in_portals, new.k_awaiting_publish, new.k_portal_missing, new.k_price_mismatch, new.k_in_review, new.k_unverifiable, new.k_healthy) then
    begin
      insert into public.listing_control_events (tenant_id, property_id, branch_id, team_id, advisor_id, event_type)
      values (new.tenant_id, new.property_id, new.branch_id, new.team_id, new.advisor_id, 'counters_changed');
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;
revoke all on function public.lc_emit_health_event() from public, anon, authenticated, service_role;
revoke all on function public.lc_emit_anomaly_event() from public, anon, authenticated, service_role;
revoke all on function public.lc_emit_counters_event() from public, anon, authenticated, service_role;

drop trigger if exists trg_lc_health_event on public.portal_listing_health;
create trigger trg_lc_health_event after insert or update of check_state on public.portal_listing_health
  for each row execute function public.lc_emit_health_event();
drop trigger if exists trg_lc_anomaly_event on public.listing_anomalies;
create trigger trg_lc_anomaly_event after insert or update of status on public.listing_anomalies
  for each row execute function public.lc_emit_anomaly_event();
drop trigger if exists trg_lc_counters_event on public.property_control_state;
create trigger trg_lc_counters_event after insert or update on public.property_control_state
  for each row execute function public.lc_emit_counters_event();

create or replace function public.lc_emit_confirm_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_check_result = 'present' and new.last_success_at is distinct from old.last_success_at then
    begin
      insert into public.listing_control_events (tenant_id, property_id, portal_listing_id, branch_id, team_id, advisor_id, event_type, payload)
      values (new.tenant_id, new.property_id, new.portal_listing_id, new.branch_id, new.team_id, new.advisor_id, 'listing_confirmed', '{}'::jsonb);
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

create or replace function public.lc_emit_closure_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property uuid;
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
begin
  begin
    select pl.property_id into v_property from public.portal_listings pl where pl.id = new.portal_listing_id and pl.tenant_id = new.tenant_id;
    if v_property is not null then
      select pr.branch_id, pr.assigned_to into v_branch, v_advisor from public.properties pr where pr.id = v_property and pr.tenant_id = new.tenant_id;
      select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
      insert into public.listing_control_events (tenant_id, property_id, portal_listing_id, branch_id, team_id, advisor_id, event_type, payload)
      values (new.tenant_id, v_property, new.portal_listing_id, v_branch, v_team, v_advisor, 'closure_recorded',
              jsonb_build_object('competitor_closed', coalesce(new.competitor_closed, false), 'deal_happened', coalesce(new.deal_happened, false)));
      perform public.lc_mark_state_stale(new.tenant_id, v_property);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.lc_emit_confirm_event() from public, anon, authenticated, service_role;
revoke all on function public.lc_emit_closure_event() from public, anon, authenticated, service_role;

drop trigger if exists trg_lc_confirm_event on public.portal_listing_health;
create trigger trg_lc_confirm_event after update of last_success_at on public.portal_listing_health
  for each row execute function public.lc_emit_confirm_event();
do $$
begin
  if pg_catalog.to_regclass('public.listing_closures') is not null then
    drop trigger if exists trg_lc_closure_event on public.listing_closures;
    create trigger trg_lc_closure_event after insert on public.listing_closures
      for each row execute function public.lc_emit_closure_event();
  end if;
end $$;

-- Realtime: yalniz append-only olay tablosu yayinlanir (yuksek degisimli health/state tablolari DEGIL).
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listing_control_events') then
    alter publication supabase_realtime add table public.listing_control_events;
  end if;
end $$;

-- ---------------------------------------------------------------- tarayici dogrulama RPC'leri (kullanici JWT'si)
create or replace function public.lc_worker_register(
  p_device_key text,
  p_label text default 'Tarayici',
  p_capabilities jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_hash text;
  v_row public.verification_clients%rowtype;
  v_caps jsonb := '{}'::jsonb;
  v_count integer;
begin
  if v_uid is null or v_tenant is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_device_key is null or char_length(p_device_key) not between 16 and 80 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  p_capabilities := coalesce(p_capabilities, '{}'::jsonb);
  if jsonb_typeof(p_capabilities -> 'bridge') = 'string' then
    v_caps := v_caps || jsonb_build_object('bridge', left(p_capabilities ->> 'bridge', 40));
  end if;
  if jsonb_typeof(p_capabilities -> 'version') = 'string' then
    v_caps := v_caps || jsonb_build_object('version', left(p_capabilities ->> 'version', 20));
  end if;
  v_hash := encode(pg_catalog.sha256(pg_catalog.convert_to(v_tenant::text || ':' || v_uid::text || ':' || p_device_key, 'utf8')), 'hex');

  select * into v_row from public.verification_clients where token_hash = v_hash;
  if found then
    if v_row.revoked_at is not null then
      return jsonb_build_object('outcome', 'client_revoked');
    end if;
    update public.verification_clients set last_seen_at = now(), capabilities = v_caps where id = v_row.id;
  else
    select count(*) into v_count from public.verification_clients
     where tenant_id = v_tenant and profile_id = v_uid and revoked_at is null;
    if v_count >= 5 then
      return jsonb_build_object('outcome', 'too_many_clients');
    end if;
    insert into public.verification_clients (tenant_id, profile_id, label, token_hash, capabilities, last_seen_at)
    values (v_tenant, v_uid, left(coalesce(nullif(btrim(p_label), ''), 'Tarayici'), 80), v_hash, v_caps, now())
    returning * into v_row;
  end if;
  return jsonb_build_object('outcome', 'ok', 'client_id', v_row.id,
    'limits', jsonb_build_object('max_per_hour', 60, 'min_interval_seconds', 20, 'batch', 1, 'lease_seconds', 180));
end;
$$;

create or replace function public.lc_worker_claim(p_client_id uuid, p_limit integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_open integer;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden', 'jobs', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.verification_clients
                  where id = p_client_id and tenant_id = v_tenant and profile_id = v_uid and revoked_at is null) then
    return jsonb_build_object('outcome', 'client_invalid', 'jobs', '[]'::jsonb);
  end if;
  select count(*) into v_open from public.listing_verification_jobs
   where tenant_id = v_tenant and assigned_client_id = p_client_id and status = 'claimed' and lease_expires_at > now();
  if v_open >= 3 then
    return jsonb_build_object('outcome', 'busy', 'jobs', '[]'::jsonb);
  end if;
  return public.lc_claim_verification_jobs(v_tenant, p_client_id, least(greatest(coalesce(p_limit, 1), 1), 2), 180, 60);
end;
$$;

create or replace function public.lc_worker_complete(
  p_client_id uuid,
  p_job_id uuid,
  p_result text,
  p_observed jsonb default '{}'::jsonb,
  p_evidence_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_job public.listing_verification_jobs%rowtype;
  v_obs jsonb := '{}'::jsonb;
  v_eff uuid := p_client_id;
  v_res jsonb;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_result not in ('present', 'absent', 'blocked', 'error') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not exists (select 1 from public.verification_clients
                  where id = p_client_id and tenant_id = v_tenant and profile_id = v_uid and revoked_at is null) then
    return jsonb_build_object('outcome', 'client_invalid');
  end if;
  select * into v_job from public.listing_verification_jobs where id = p_job_id and tenant_id = v_tenant;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;
  if v_job.status = 'completed' then
    return jsonb_build_object('outcome', 'replay');
  end if;
  if v_job.status <> 'claimed' or v_job.assigned_client_id is distinct from p_client_id then
    return jsonb_build_object('outcome', 'job_client_mismatch');
  end if;

  -- Yalniz izinli, sinirli alanlar (ham HTML / kisisel veri alinmaz).
  p_observed := coalesce(p_observed, '{}'::jsonb);
  if jsonb_typeof(p_observed -> 'price') = 'number' and (p_observed ->> 'price')::numeric > 0 and (p_observed ->> 'price')::numeric < 1e12 then
    v_obs := v_obs || jsonb_build_object('price', p_observed -> 'price');
  end if;
  if jsonb_typeof(p_observed -> 'title') = 'string' then v_obs := v_obs || jsonb_build_object('title', left(p_observed ->> 'title', 300)); end if;
  if jsonb_typeof(p_observed -> 'advisor_name') = 'string' then v_obs := v_obs || jsonb_build_object('advisor_name', left(p_observed ->> 'advisor_name', 120)); end if;
  if jsonb_typeof(p_observed -> 'status') = 'string' then v_obs := v_obs || jsonb_build_object('status', left(p_observed ->> 'status', 40)); end if;
  if jsonb_typeof(p_observed -> 'error_code') = 'string' then v_obs := v_obs || jsonb_build_object('error_code', left(p_observed ->> 'error_code', 60)); end if;

  -- Ayni kullanicinin baska cihazi zaten "yok" dediyse bu gozlem BAGIMSIZ sayilmaz.
  if p_result = 'absent' and exists (
    select 1 from public.portal_listing_health h
      join public.verification_clients c on c.id = any (h.absent_client_ids)
     where h.portal_listing_id = v_job.listing_id and h.tenant_id = v_tenant and c.profile_id = v_uid and c.id <> p_client_id
  ) then
    v_eff := null;
  end if;

  v_res := public.lc_apply_check(v_tenant, v_job.listing_id, p_result, 'assisted', v_eff, p_job_id, v_obs, left(p_evidence_hash, 128), '{}'::jsonb, null);
  if v_res ->> 'outcome' = 'applied' then
    perform public.lc_mark_state_stale(v_tenant, (v_res ->> 'property_id')::uuid);
  end if;
  update public.verification_clients set last_seen_at = now() where id = p_client_id;
  return v_res;
end;
$$;

create or replace function public.lc_worker_release(p_client_id uuid, p_job_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_job public.listing_verification_jobs%rowtype;
  v_retry integer;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if not exists (select 1 from public.verification_clients
                  where id = p_client_id and tenant_id = v_tenant and profile_id = v_uid and revoked_at is null) then
    return jsonb_build_object('outcome', 'client_invalid');
  end if;
  select * into v_job from public.listing_verification_jobs
   where id = p_job_id and tenant_id = v_tenant and status = 'claimed' and assigned_client_id = p_client_id for update;
  if not found then
    return jsonb_build_object('outcome', 'job_not_found');
  end if;
  v_retry := v_job.retry_count + 1;
  update public.listing_verification_jobs set
    status = case when v_retry >= 3 then 'failed' else 'queued' end,
    retry_count = v_retry,
    assigned_client_id = null, claimed_at = null, lease_expires_at = null,
    scheduled_at = now() + make_interval(mins => least(60, 10 * v_retry)),
    exclude_client_ids = case when p_client_id = any (exclude_client_ids) then exclude_client_ids else array_append(exclude_client_ids, p_client_id) end,
    completed_at = case when v_retry >= 3 then now() else null end
   where id = p_job_id;
  return jsonb_build_object('outcome', 'released', 'retry_count', v_retry);
end;
$$;

revoke all on function public.lc_worker_register(text, text, jsonb) from public, anon;
revoke all on function public.lc_worker_claim(uuid, integer) from public, anon;
revoke all on function public.lc_worker_complete(uuid, uuid, text, jsonb, text) from public, anon;
revoke all on function public.lc_worker_release(uuid, uuid, text) from public, anon;
grant execute on function public.lc_worker_register(text, text, jsonb) to authenticated;
grant execute on function public.lc_worker_claim(uuid, integer) to authenticated;
grant execute on function public.lc_worker_complete(uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.lc_worker_release(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- lc_sync_anomalies: yeniden acma sogutmasi
create or replace function public.lc_sync_anomalies(
  p_tenant_id uuid,
  p_property_id uuid,
  p_desired jsonb,
  p_managed_types text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
  v_keys text[] := '{}';
  v_opened integer := 0;
  v_reopened integer := 0;
  v_updated integer := 0;
  v_closed integer := 0;
  j jsonb;
  a public.listing_anomalies%rowtype;
  v_id uuid;
begin
  select pr.branch_id, pr.assigned_to into v_branch, v_advisor
    from public.properties pr where pr.id = p_property_id and pr.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;

  if p_desired is not null and jsonb_typeof(p_desired) = 'array' then
    for j in select e from jsonb_array_elements(p_desired) as e limit 50 loop
      v_keys := array_append(v_keys, j ->> 'dedupe_key');
      select * into a from public.listing_anomalies
       where tenant_id = p_tenant_id and dedupe_key = j ->> 'dedupe_key' for update;
      if not found then
        insert into public.listing_anomalies
          (tenant_id, property_id, portal_listing_id, type, severity, dedupe_key, branch_id, team_id, advisor_id, assignee_id,
           risk_score, risk_points, details, sla_due_at)
        values
          (p_tenant_id, p_property_id, nullif(j ->> 'portal_listing_id', '')::uuid, j ->> 'type',
           coalesce(nullif(j ->> 'severity', ''), 'medium'), j ->> 'dedupe_key', v_branch, v_team, v_advisor, v_advisor,
           nullif(j ->> 'risk_score', '')::smallint, coalesce(j -> 'risk_points', '[]'::jsonb),
           coalesce(j -> 'details', '{}'::jsonb), nullif(j ->> 'sla_due_at', '')::timestamptz)
        returning id into v_id;
        insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action) values (p_tenant_id, v_id, 'opened');
        v_opened := v_opened + 1;
      elsif a.status = 'false_positive' then
        update public.listing_anomalies set last_seen_at = now() where id = a.id;
      elsif a.status in ('resolved', 'auto_closed')
            and a.resolved_at is not null
            and a.resolved_at > now() - (case when a.status = 'resolved' then interval '24 hours' else interval '2 hours' end) then
        -- Sogutma: yeni kapanmis alarm ayni anahtarla hemen yeniden acilmaz (alarm yagmuru/dalgalanma bastirma).
        update public.listing_anomalies set last_seen_at = now() where id = a.id;
      elsif a.status in ('resolved', 'auto_closed') then
        update public.listing_anomalies set status = 'open', sla_stage = 0, resolved_at = null, last_seen_at = now(),
               severity = coalesce(nullif(j ->> 'severity', ''), severity), branch_id = v_branch, team_id = v_team,
               advisor_id = v_advisor, assignee_id = v_advisor,
               risk_score = nullif(j ->> 'risk_score', '')::smallint, risk_points = coalesce(j -> 'risk_points', '[]'::jsonb),
               details = coalesce(j -> 'details', '{}'::jsonb), sla_due_at = nullif(j ->> 'sla_due_at', '')::timestamptz,
               explained_reason_code = null, explained_note = null, explained_by = null, explained_at = null
         where id = a.id;
        insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action) values (p_tenant_id, a.id, 'reopened');
        v_reopened := v_reopened + 1;
      else
        update public.listing_anomalies set last_seen_at = now(),
               severity = coalesce(nullif(j ->> 'severity', ''), severity), branch_id = v_branch, team_id = v_team,
               advisor_id = v_advisor, risk_score = nullif(j ->> 'risk_score', '')::smallint,
               risk_points = coalesce(j -> 'risk_points', '[]'::jsonb), details = coalesce(j -> 'details', '{}'::jsonb)
         where id = a.id;
        v_updated := v_updated + 1;
      end if;
    end loop;
  end if;

  with closed as (
    update public.listing_anomalies set status = 'auto_closed', resolved_at = now()
     where tenant_id = p_tenant_id and property_id = p_property_id
       and status in ('open', 'acknowledged', 'explained')
       and type = any (coalesce(p_managed_types, '{}'::text[]))
       and not (dedupe_key = any (v_keys))
    returning id
  ), logged as (
    insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action)
    select p_tenant_id, id, 'auto_closed' from closed returning 1
  )
  select count(*) into v_closed from logged;

  return jsonb_build_object('outcome', 'ok', 'opened', v_opened, 'reopened', v_reopened, 'updated', v_updated, 'closed', v_closed);
end;
$$;

notify pgrst, 'reload schema';
