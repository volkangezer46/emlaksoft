-- MIGRATION 20260826002050_lc_queue_and_check_rpcs.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002050_lc_queue_and_check_rpcs.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002050_lc_queue_and_check_rpcs.rollback.sql
-- BAGIMLILIK: 20260826002000, 20260826002010, 20260826002020.
--
-- RPC'ler:
--   lc_enqueue_verification_jobs  (service_role)   kontrol isi uret; ayni ilan icin tek acik is (kismi unique, on conflict do nothing)
--   lc_claim_verification_jobs    (service_role)   istemci icin is al: FOR UPDATE SKIP LOCKED + lease + saatlik hiz siniri
--   lc_reap_verification_jobs     (service_role)   suresi dolan lease'i kuyruga dondur (3. denemede failed)
--   lc_complete_listing_check     (service_role)   kontrol sonucunu isle: SUPHELI -> ONAYLI KAYIP durum makinesi, idempotent
--   lc_submit_manual_check        (authenticated)  danismanin elle "yayinda / portalda yok" dogrulamasi (JWT'den ofis+kullanici)
-- Durum makinesi TS esi: src/lib/listing-control/check-state-machine.ts (esik sabitleri contract testle karsilastirilir).
--   absent: 1. -> suspect (0.30) · 2. -> probable_missing (0.70) · 3. -> confirmed_missing (0.95 farkli istemci / 0.85 tek istemci,
--   en az 6 saat sonra). Resmi kaynak (api/feed/csv): 1. suspect, 2. confirmed. manual absent -> confirmed (0.90).
--   Gozlemler arasi en az min_gap_minutes (10) olmadan sayac ARTMAZ. blocked/error ASLA absent sayilmaz -> unverifiable.
--   present -> verified, sayac sifirlanir.
-- Bu RPC'ler portal_listings'e YAZMAZ (guard_portal_listing_atomic_mutation); yalniz health/verifications/jobs.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.portal_listing_health') is null
     or pg_catalog.to_regclass('public.listing_verification_jobs') is null
     or pg_catalog.to_regclass('public.property_control_state') is null then
    raise exception 'portal_listing_health/listing_verification_jobs/property_control_state yok; once 20260826002020 ve 20260826002040 uygulanmali.';
  end if;
end $$;

create or replace function public.lc_enqueue_verification_jobs(p_tenant_id uuid, p_jobs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_n integer;
  j jsonb;
begin
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' then
    return 0;
  end if;
  for j in select e from jsonb_array_elements(p_jobs) as e limit 500 loop
    insert into public.listing_verification_jobs
      (tenant_id, listing_id, property_id, portal, priority, reason, scheduled_at, exclude_client_ids)
    select pl.tenant_id, pl.id, pl.property_id, pl.portal_name,
           coalesce((j ->> 'priority')::smallint, 0),
           coalesce(nullif(j ->> 'reason', ''), 'scheduled'),
           coalesce((j ->> 'scheduled_at')::timestamptz, now()),
           coalesce(array(select jsonb_array_elements_text(j -> 'exclude_client_ids')::uuid), '{}'::uuid[])
      from public.portal_listings pl
     where pl.id = (j ->> 'portal_listing_id')::uuid and pl.tenant_id = p_tenant_id and pl.status = 'live'
    on conflict (listing_id) where status in ('queued', 'claimed') do nothing;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

create or replace function public.lc_claim_verification_jobs(
  p_tenant_id uuid,
  p_client_id uuid,
  p_limit integer default 3,
  p_lease_seconds integer default 180,
  p_max_per_hour integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 3);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 180), 30), 900);
  v_max integer := least(greatest(coalesce(p_max_per_hour, 120), 1), 600);
  v_jobs jsonb;
begin
  perform 1 from public.verification_clients
   where id = p_client_id and tenant_id = p_tenant_id and revoked_at is null for update;
  if not found then
    return jsonb_build_object('outcome', 'client_invalid', 'jobs', '[]'::jsonb);
  end if;
  select count(*) into v_recent from public.listing_verification_jobs
   where tenant_id = p_tenant_id and assigned_client_id = p_client_id and claimed_at > now() - interval '1 hour';
  if v_recent >= v_max then
    return jsonb_build_object('outcome', 'rate_limited', 'jobs', '[]'::jsonb);
  end if;
  v_limit := least(v_limit, v_max - v_recent);

  with picked as (
    select id from public.listing_verification_jobs
     where tenant_id = p_tenant_id and status = 'queued' and scheduled_at <= now()
       and not (p_client_id = any (exclude_client_ids))
     order by priority desc, scheduled_at, id
     limit v_limit
     for update skip locked
  ), upd as (
    update public.listing_verification_jobs j
       set status = 'claimed', assigned_client_id = p_client_id, claimed_at = now(),
           lease_expires_at = now() + make_interval(secs => v_lease)
      from picked
     where j.id = picked.id
    returning j.id, j.listing_id, j.portal
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', upd.id, 'listing_id', upd.listing_id, 'portal', upd.portal,
           'external_id', pl.portal_listing_id, 'url', pl.portal_url)), '[]'::jsonb)
    into v_jobs
    from upd join public.portal_listings pl on pl.id = upd.listing_id;

  update public.verification_clients set last_claim_at = now(), last_seen_at = now() where id = p_client_id;
  return jsonb_build_object('outcome', 'ok', 'jobs', v_jobs);
end;
$$;

create or replace function public.lc_reap_verification_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requeued integer;
  v_failed integer;
begin
  with expired as (
    select id, retry_count from public.listing_verification_jobs
     where status = 'claimed' and lease_expires_at < now()
     for update skip locked
  ), upd as (
    update public.listing_verification_jobs j
       set status = case when e.retry_count + 1 >= 3 then 'failed' else 'queued' end,
           retry_count = e.retry_count + 1,
           assigned_client_id = null, claimed_at = null, lease_expires_at = null,
           completed_at = case when e.retry_count + 1 >= 3 then now() else null end
      from expired e
     where j.id = e.id
    returning j.status
  )
  select count(*) filter (where status = 'queued'), count(*) filter (where status = 'failed')
    into v_requeued, v_failed from upd;
  return jsonb_build_object('requeued', coalesce(v_requeued, 0), 'failed', coalesce(v_failed, 0));
end;
$$;

-- ICERIDEN cagrilan cekirdek: tenant/yetki kontrolu CAGIRANDA (iki sarmalayici asagida). Dogrudan EXECUTE verilmez.
create or replace function public.lc_apply_check(
  p_tenant_id uuid,
  p_listing_id uuid,
  p_result text,
  p_source_kind text,
  p_client_id uuid,
  p_job_id uuid,
  p_observed jsonb,
  p_evidence_hash text,
  p_policy jsonb,
  p_checked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_checked_at, now());
  v_pl public.portal_listings%rowtype;
  v_prop_branch uuid;
  v_prop_advisor uuid;
  v_team uuid;
  v_job public.listing_verification_jobs%rowtype;
  h public.portal_listing_health%rowtype;
  v_min_gap integer := coalesce((p_policy ->> 'min_gap_minutes')::integer, 10);
  v_wait_hours integer := coalesce((p_policy ->> 'single_client_wait_hours')::integer, 6);
  v_normal_hours integer := coalesce((p_policy ->> 'normal_hours')::integer, 24);
  v_authoritative boolean := p_source_kind in ('api', 'feed', 'csv');
  v_base numeric(3, 2);
  v_state text;
  v_conf numeric(3, 2);
  v_absent smallint;
  v_counts boolean;
  v_need smallint;
  v_independent boolean;
  v_waited boolean;
  v_first_absent timestamptz;
  v_last_absent timestamptz;
  v_clients uuid[];
  v_failures smallint;
  v_err text;
  v_price numeric;
  v_next timestamptz;
  v_before text;
begin
  if p_result not in ('present', 'absent', 'blocked', 'error') or p_source_kind not in ('manual', 'api', 'feed', 'csv', 'assisted') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  p_observed := coalesce(p_observed, '{}'::jsonb);

  select * into v_pl from public.portal_listings where id = p_listing_id and tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_pl.status <> 'live' then
    return jsonb_build_object('outcome', 'not_live');
  end if;

  if p_job_id is not null then
    select * into v_job from public.listing_verification_jobs
     where id = p_job_id and tenant_id = p_tenant_id and listing_id = p_listing_id for update;
    if not found then
      return jsonb_build_object('outcome', 'job_not_found');
    end if;
    if v_job.status = 'completed' then
      return jsonb_build_object('outcome', 'replay');
    end if;
    if v_job.status not in ('claimed', 'queued') then
      return jsonb_build_object('outcome', 'job_closed');
    end if;
    if p_client_id is not null and v_job.assigned_client_id is distinct from p_client_id then
      return jsonb_build_object('outcome', 'job_client_mismatch');
    end if;
  end if;

  select pr.branch_id, pr.assigned_to into v_prop_branch, v_prop_advisor
    from public.properties pr where pr.id = v_pl.property_id and pr.tenant_id = p_tenant_id;
  select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team
    from public.profiles pf where pf.id = v_prop_advisor;

  insert into public.portal_listing_health (portal_listing_id, tenant_id, property_id, branch_id, team_id, advisor_id)
  values (p_listing_id, p_tenant_id, v_pl.property_id, v_prop_branch, v_team, v_prop_advisor)
  on conflict (portal_listing_id) do nothing;
  select * into h from public.portal_listing_health where portal_listing_id = p_listing_id for update;

  if h.check_state = 'paused' and p_source_kind <> 'manual' then
    return jsonb_build_object('outcome', 'paused');
  end if;

  v_before := h.check_state;
  v_base := case p_source_kind when 'api' then 0.95 when 'feed' then 0.85 when 'csv' then 0.85 when 'manual' then 0.90 else 0.70 end;
  v_state := h.check_state;
  v_conf := h.confidence;
  v_absent := h.consecutive_absent;
  v_first_absent := h.first_absent_at;
  v_last_absent := h.last_absent_at;
  v_clients := h.absent_client_ids;
  v_failures := h.check_failures;
  v_err := h.error_code;
  v_price := h.portal_price;
  v_next := h.next_check_at;

  if p_result = 'present' then
    v_state := 'verified'; v_conf := v_base; v_absent := 0; v_first_absent := null; v_last_absent := null;
    v_clients := '{}'::uuid[]; v_failures := 0; v_err := null;
    if jsonb_typeof(p_observed -> 'price') = 'number' then v_price := (p_observed ->> 'price')::numeric; end if;
    v_next := v_now + make_interval(hours => v_normal_hours);
  elsif p_result = 'absent' then
    if p_source_kind = 'manual' then
      v_state := 'confirmed_missing'; v_conf := 0.90; v_absent := greatest(v_absent, 1);
      v_first_absent := coalesce(v_first_absent, v_now); v_last_absent := v_now;
      v_next := v_now + make_interval(hours => v_normal_hours);
    else
      v_counts := v_last_absent is null or v_now - v_last_absent >= make_interval(mins => v_min_gap);
      if v_counts then
        v_absent := least(v_absent + 1, 100);
        v_last_absent := v_now;
        if p_client_id is not null and not (p_client_id = any (v_clients)) then
          v_clients := array_append(v_clients, p_client_id);
        end if;
      end if;
      v_first_absent := coalesce(v_first_absent, v_now);
      v_need := case when v_authoritative then 2 else 3 end;
      if v_absent >= v_need then
        v_independent := p_client_id is not null and array_length(v_clients, 1) >= 2;
        v_waited := v_now - v_first_absent >= make_interval(hours => v_wait_hours);
        if v_authoritative then
          v_state := 'confirmed_missing'; v_conf := v_base;
        elsif v_independent then
          v_state := 'confirmed_missing'; v_conf := 0.95;
        elsif v_waited then
          v_state := 'confirmed_missing'; v_conf := 0.85;
        else
          v_state := 'probable_missing'; v_conf := 0.70;
        end if;
      elsif v_absent = 1 then
        v_state := 'suspect'; v_conf := 0.30;
      else
        v_state := 'probable_missing'; v_conf := 0.70;
      end if;
      v_next := case when v_state = 'confirmed_missing' then v_now + make_interval(hours => v_normal_hours)
                     else v_now + make_interval(mins => greatest(v_min_gap, 10)) end;
    end if;
  else
    -- blocked / error: ASLA kayip sayilmaz.
    v_failures := least(v_failures + 1, 100);
    v_err := left(coalesce(nullif(p_observed ->> 'error_code', ''), p_result), 60);
    v_state := case when h.check_state in ('suspect', 'probable_missing', 'confirmed_missing') then h.check_state else 'unverifiable' end;
    v_next := v_now + make_interval(mins => least(240, 30 * (2 ^ least(v_failures - 1, 3))::integer));
  end if;

  update public.portal_listing_health set
    branch_id = v_prop_branch, team_id = v_team, advisor_id = v_prop_advisor,
    check_state = v_state, confidence = v_conf, consecutive_absent = v_absent,
    first_absent_at = v_first_absent, last_absent_at = v_last_absent, absent_client_ids = v_clients,
    last_check_at = v_now, last_check_result = p_result,
    last_success_at = case when p_result in ('present', 'absent') then v_now else h.last_success_at end,
    last_seen_at = case when p_result = 'present' then v_now else h.last_seen_at end,
    check_failures = v_failures, error_code = v_err, portal_price = v_price,
    portal_title = case when p_result = 'present' then left(nullif(p_observed ->> 'title', ''), 300) else h.portal_title end,
    portal_advisor_name = case when p_result = 'present' then left(nullif(p_observed ->> 'advisor_name', ''), 120) else h.portal_advisor_name end,
    portal_status = case when p_result = 'present' then left(nullif(p_observed ->> 'status', ''), 40) else h.portal_status end,
    portal_active = case when p_result = 'present' then true when p_result = 'absent' then false else h.portal_active end,
    last_source_kind = p_source_kind, last_client_id = coalesce(p_client_id, h.last_client_id),
    next_check_at = v_next, updated_at = now()
   where portal_listing_id = p_listing_id;

  insert into public.listing_verifications
    (tenant_id, portal_listing_id, property_id, branch_id, team_id, advisor_id, checked_at, result, source_kind,
     client_id, job_id, observed, evidence_hash, confidence, state_before, state_after)
  values
    (p_tenant_id, p_listing_id, v_pl.property_id, v_prop_branch, v_team, v_prop_advisor, v_now, p_result, p_source_kind,
     p_client_id, p_job_id, p_observed, left(p_evidence_hash, 128), v_conf, v_before, v_state);

  if p_job_id is not null then
    update public.listing_verification_jobs set status = 'completed', completed_at = now() where id = p_job_id;
  end if;

  return jsonb_build_object('outcome', 'applied', 'property_id', v_pl.property_id, 'state_before', v_before,
    'state_after', v_state, 'state_changed', v_before is distinct from v_state, 'confidence', v_conf,
    'consecutive_absent', v_absent);
end;
$$;

create or replace function public.lc_complete_listing_check(
  p_tenant_id uuid,
  p_listing_id uuid,
  p_result text,
  p_source_kind text,
  p_client_id uuid default null,
  p_job_id uuid default null,
  p_observed jsonb default '{}'::jsonb,
  p_evidence_hash text default null,
  p_policy jsonb default '{}'::jsonb,
  p_checked_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.lc_apply_check(p_tenant_id, p_listing_id, p_result, p_source_kind, p_client_id, p_job_id,
                               p_observed, p_evidence_hash, p_policy, p_checked_at);
$$;

-- Danismanin elle dogrulamasi: ofis + kullanici JWT'den; portals/edit izni + satir kapsami zorunlu.
create or replace function public.lc_submit_manual_check(
  p_listing_id uuid,
  p_result text,
  p_observed jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_pl public.portal_listings%rowtype;
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
  v_obs jsonb := '{}'::jsonb;
  v_res jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_result not in ('present', 'absent') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into v_pl from public.portal_listings where id = p_listing_id and tenant_id = v_tenant;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select pr.branch_id, pr.assigned_to into v_branch, v_advisor
    from public.properties pr where pr.id = v_pl.property_id and pr.tenant_id = v_tenant;
  select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
  if not public.lc_row_visible(v_branch, v_team, v_advisor) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  -- Yalniz izinli alanlar (fiyat/baslik/durum); ham metin ve kisisel veri alinmaz.
  if jsonb_typeof(coalesce(p_observed, '{}'::jsonb) -> 'price') = 'number' then
    v_obs := v_obs || jsonb_build_object('price', p_observed -> 'price');
  end if;
  if jsonb_typeof(p_observed -> 'title') = 'string' then
    v_obs := v_obs || jsonb_build_object('title', left(p_observed ->> 'title', 300));
  end if;
  v_res := public.lc_apply_check(v_tenant, p_listing_id, p_result, 'manual', null, null, v_obs, null, '{}'::jsonb, null);
  if v_res ->> 'outcome' = 'applied' then
    perform public.lc_mark_state_stale(v_tenant, v_pl.property_id);
  end if;
  return v_res;
end;
$$;

revoke all on function public.lc_enqueue_verification_jobs(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lc_claim_verification_jobs(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.lc_reap_verification_jobs() from public, anon, authenticated;
revoke all on function public.lc_apply_check(uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.lc_complete_listing_check(uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.lc_submit_manual_check(uuid, text, jsonb) from public, anon;
grant execute on function public.lc_enqueue_verification_jobs(uuid, jsonb) to service_role;
grant execute on function public.lc_claim_verification_jobs(uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.lc_reap_verification_jobs() to service_role;
grant execute on function public.lc_complete_listing_check(uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, timestamptz) to service_role;
grant execute on function public.lc_submit_manual_check(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
