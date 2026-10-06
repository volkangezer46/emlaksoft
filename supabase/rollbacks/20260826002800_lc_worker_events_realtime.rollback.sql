-- Rollback: 20260826002800_lc_worker_events_realtime. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Olay gunlugu verisi silinir (turetilmis/gecici veri); verification_clients satirlari KORUNUR.
-- lc_sync_anomalies: sogutmasiz ONCEKI govde (20260826002060) geri yuklenir.
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

drop trigger if exists trg_lc_closure_event on public.listing_closures;
drop trigger if exists trg_lc_confirm_event on public.portal_listing_health;
drop function if exists public.lc_emit_closure_event();
drop function if exists public.lc_emit_confirm_event();
drop function if exists public.lc_worker_release(uuid, uuid, text);
drop function if exists public.lc_worker_complete(uuid, uuid, text, jsonb, text);
drop function if exists public.lc_worker_claim(uuid, integer);
drop function if exists public.lc_worker_register(text, text, jsonb);
drop trigger if exists trg_lc_counters_event on public.property_control_state;
drop trigger if exists trg_lc_anomaly_event on public.listing_anomalies;
drop trigger if exists trg_lc_health_event on public.portal_listing_health;
drop function if exists public.lc_emit_counters_event();
drop function if exists public.lc_emit_anomaly_event();
drop function if exists public.lc_emit_health_event();
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listing_control_events') then
    alter publication supabase_realtime drop table public.listing_control_events;
  end if;
end $$;
drop table if exists public.listing_control_events;
notify pgrst, 'reload schema';
