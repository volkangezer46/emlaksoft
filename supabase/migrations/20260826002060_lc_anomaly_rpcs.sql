-- MIGRATION 20260826002060_lc_anomaly_rpcs.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002060_lc_anomaly_rpcs.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002060_lc_anomaly_rpcs.rollback.sql
-- BAGIMLILIK: 20260826002010, 20260826002030.
--
-- service_role (kural motoru/cron):
--   lc_sync_anomalies            istenen anomali kumesini esitle: yeni ac, kapanmisi yeniden ac, kosulu kalmayani auto_closed
--   lc_escalate_anomaly          SLA asamasini kaydet (anomali, asama) tekil -> ayni asama tekrar bildirilmez
--   lc_register_matching_candidates / lc_decide_matching_candidate   kayitsiz ilan eslestirme
-- authenticated (JWT'den ofis+kullanici; portals/edit izni + satir kapsami):
--   lc_acknowledge_anomaly, lc_explain_anomaly (ACIKLAMA ZORUNLU: kodlu neden; 'other' icin not),
--   lc_resolve_anomaly (aciklama yoksa kapatilamaz; false_positive yalniz yonetim + not)
-- 'Satildi/Kiralandi' aciklamasi CRM'i otomatik DEGISTIRMEZ; yanit suggest_closure=true doner (insan onayi).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.listing_anomalies') is null or pg_catalog.to_regclass('public.property_control_state') is null then
    raise exception 'listing_anomalies/property_control_state yok; once 20260826002030 ve 20260826002040 uygulanmali.';
  end if;
end $$;

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

create or replace function public.lc_escalate_anomaly(
  p_tenant_id uuid,
  p_anomaly_id uuid,
  p_stage smallint,
  p_recipient_role text,
  p_recipient_id uuid,
  p_notification_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_due timestamptz;
begin
  select sla_due_at into v_due from public.listing_anomalies
   where id = p_anomaly_id and tenant_id = p_tenant_id and status in ('open', 'acknowledged');
  if not found then
    return jsonb_build_object('outcome', 'not_open', 'inserted', false);
  end if;
  insert into public.listing_sla_events (tenant_id, anomaly_id, stage, recipient_role, recipient_id, due_at, notification_key)
  values (p_tenant_id, p_anomaly_id, p_stage, p_recipient_role, p_recipient_id, v_due, p_notification_key)
  on conflict (anomaly_id, stage) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    update public.listing_anomalies set sla_stage = greatest(sla_stage, p_stage) where id = p_anomaly_id;
    insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, stage, note)
    values (p_tenant_id, p_anomaly_id, 'escalated', p_stage, p_recipient_role);
  end if;
  return jsonb_build_object('outcome', 'ok', 'inserted', v_n = 1);
end;
$$;

create or replace function public.lc_register_matching_candidates(p_tenant_id uuid, p_items jsonb)
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;
  for j in select e from jsonb_array_elements(p_items) as e limit 500 loop
    insert into public.listing_matching_candidates
      (tenant_id, portal, external_id, url, title, price, source_kind, candidates, top_score)
    values
      (p_tenant_id, j ->> 'portal', j ->> 'external_id', left(j ->> 'url', 2048), left(j ->> 'title', 300),
       case when jsonb_typeof(j -> 'price') = 'number' then (j ->> 'price')::numeric end,
       coalesce(nullif(j ->> 'source_kind', ''), 'csv'), coalesce(j -> 'candidates', '[]'::jsonb),
       nullif(j ->> 'top_score', '')::numeric)
    on conflict (tenant_id, portal, external_id) do update
      set last_seen_at = now(), url = excluded.url, title = excluded.title, price = excluded.price,
          candidates = excluded.candidates, top_score = excluded.top_score
      where public.listing_matching_candidates.status = 'open';
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

create or replace function public.lc_decide_matching_candidate(
  p_tenant_id uuid,
  p_candidate_id uuid,
  p_status text,
  p_actor_id uuid,
  p_linked_listing_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('linked', 'ignored') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  update public.listing_matching_candidates
     set status = p_status, decided_by = p_actor_id, decided_at = now(), linked_listing_id = p_linked_listing_id
   where id = p_candidate_id and tenant_id = p_tenant_id and status = 'open';
  if not found then
    return jsonb_build_object('outcome', 'not_open');
  end if;
  return jsonb_build_object('outcome', 'ok');
end;
$$;

-- ---- Kullanici RPC'leri (authenticated) ----
create or replace function public.lc_acknowledge_anomaly(p_anomaly_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  a public.listing_anomalies%rowtype;
begin
  if auth.uid() is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into a from public.listing_anomalies where id = p_anomaly_id and tenant_id = v_tenant for update;
  if not found or not public.lc_row_visible(a.branch_id, a.team_id, a.advisor_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if a.status <> 'open' then
    return jsonb_build_object('outcome', 'not_open');
  end if;
  update public.listing_anomalies set status = 'acknowledged' where id = a.id;
  insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, actor_id) values (v_tenant, a.id, 'acknowledged', auth.uid());
  perform public.lc_mark_state_stale(v_tenant, a.property_id);
  return jsonb_build_object('outcome', 'ok');
end;
$$;

create or replace function public.lc_explain_anomaly(p_anomaly_id uuid, p_reason_code text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  a public.listing_anomalies%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if auth.uid() is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_reason_code is null or p_reason_code not in
     ('sold', 'rented', 'owner_withdrew', 'authority_expired', 'price_will_update', 'portal_removed', 'will_republish', 'mistake', 'other') then
    return jsonb_build_object('outcome', 'reason_required');
  end if;
  if p_reason_code = 'other' and (v_note is null or char_length(v_note) < 3) then
    return jsonb_build_object('outcome', 'note_required');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('outcome', 'note_too_long');
  end if;
  select * into a from public.listing_anomalies where id = p_anomaly_id and tenant_id = v_tenant for update;
  if not found or not public.lc_row_visible(a.branch_id, a.team_id, a.advisor_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if a.status not in ('open', 'acknowledged', 'explained') then
    return jsonb_build_object('outcome', 'already_closed');
  end if;
  update public.listing_anomalies
     set status = 'explained', explained_reason_code = p_reason_code, explained_note = v_note,
         explained_by = auth.uid(), explained_at = now()
   where id = a.id;
  insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, actor_id, reason_code, note)
  values (v_tenant, a.id, 'explained', auth.uid(), p_reason_code, v_note);
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, auth.uid(), 'listing_anomaly.explain', 'listing_anomaly', a.id,
          jsonb_build_object('reason_code', p_reason_code, 'type', a.type));
  perform public.lc_mark_state_stale(v_tenant, a.property_id);
  return jsonb_build_object('outcome', 'ok', 'reason_code', p_reason_code,
                            'suggest_closure', p_reason_code in ('sold', 'rented'), 'property_id', a.property_id);
end;
$$;

create or replace function public.lc_resolve_anomaly(p_anomaly_id uuid, p_resolution text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  a public.listing_anomalies%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if auth.uid() is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_resolution not in ('resolved', 'false_positive') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into a from public.listing_anomalies where id = p_anomaly_id and tenant_id = v_tenant for update;
  if not found or not public.lc_row_visible(a.branch_id, a.team_id, a.advisor_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if a.status not in ('open', 'acknowledged', 'explained') then
    return jsonb_build_object('outcome', 'already_closed');
  end if;
  if p_resolution = 'false_positive' then
    if public.current_profile_role() not in ('owner', 'gm', 'branch_manager', 'team_lead') then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
    if v_note is null or char_length(v_note) < 3 then
      return jsonb_build_object('outcome', 'note_required');
    end if;
  elsif a.explained_reason_code is null then
    return jsonb_build_object('outcome', 'explanation_required');
  end if;
  update public.listing_anomalies set status = p_resolution, resolved_at = now() where id = a.id;
  insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, actor_id, note)
  values (v_tenant, a.id, p_resolution, auth.uid(), left(v_note, 500));
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, auth.uid(), 'listing_anomaly.' || p_resolution, 'listing_anomaly', a.id, jsonb_build_object('type', a.type));
  perform public.lc_mark_state_stale(v_tenant, a.property_id);
  return jsonb_build_object('outcome', 'ok');
end;
$$;

revoke all on function public.lc_sync_anomalies(uuid, uuid, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.lc_escalate_anomaly(uuid, uuid, smallint, text, uuid, text) from public, anon, authenticated;
revoke all on function public.lc_register_matching_candidates(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lc_decide_matching_candidate(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.lc_acknowledge_anomaly(uuid) from public, anon;
revoke all on function public.lc_explain_anomaly(uuid, text, text) from public, anon;
revoke all on function public.lc_resolve_anomaly(uuid, text, text) from public, anon;
grant execute on function public.lc_sync_anomalies(uuid, uuid, jsonb, text[]) to service_role;
grant execute on function public.lc_escalate_anomaly(uuid, uuid, smallint, text, uuid, text) to service_role;
grant execute on function public.lc_register_matching_candidates(uuid, jsonb) to service_role;
grant execute on function public.lc_decide_matching_candidate(uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.lc_acknowledge_anomaly(uuid) to authenticated;
grant execute on function public.lc_explain_anomaly(uuid, text, text) to authenticated;
grant execute on function public.lc_resolve_anomaly(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
