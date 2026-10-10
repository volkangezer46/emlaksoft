-- Rollback: 20261010000500_listing_control_daily_sync. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- lc_inventory_import 20261007000210 govdesine doner; eklenen kolonlar duser (expected_count/read_count/detail verisi kaybolur;
-- baska hicbir nesne bunlara bagli degildir). Yazilmis gozlemler, adaylar ve anomaliler KALIR.

set local lock_timeout = '5s';

create or replace function public.lc_inventory_import(
  p_portal text,
  p_scope text,
  p_source text,
  p_complete boolean,
  p_observations jsonb,
  p_candidates jsonb,
  p_summary jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_role text := coalesce(public.current_profile_role(), '');
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_source_kind text;
  j jsonb;
  c jsonb;
  v_obs jsonb;
  v_pl public.portal_listings%rowtype;
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
  v_res jsonb;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_registered integer := 0;
  v_opened integer := 0;
  v_prop uuid;
  v_score numeric;
  v_key text;
  v_anomaly uuid;
  v_import uuid;
  v_s jsonb := coalesce(p_summary, '{}'::jsonb);
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_portal !~ '^[a-z0-9-]{2,40}$' or p_scope not in ('mine', 'office') or p_source not in ('csv', 'paste', 'extension') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if p_scope = 'office' and v_role not in ('owner', 'gm', 'branch_manager') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if (p_observations is not null and (jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations) > 2000))
     or (p_candidates is not null and (jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 1000)) then
    return jsonb_build_object('outcome', 'too_many');
  end if;
  -- Eklentinin magaza sayfasindan okudugu liste kullanici destekli gozlemdir (3 gozlem ister); dosya/yapistirma yetkili kaynak.
  v_source_kind := case when p_source = 'extension' then 'assisted' else 'csv' end;

  -- (a) CRM canli ilan gozlemleri
  for j in select e from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb)) as e loop
    if j ->> 'result' not in ('present', 'absent') or (j ->> 'result' = 'absent' and not coalesce(p_complete, false)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      select * into v_pl from public.portal_listings
       where id = (j ->> 'listing_id')::uuid and tenant_id = v_tenant and status = 'live'
         and lower(btrim(portal_name)) = v_portal;
    exception when invalid_text_representation then
      v_skipped := v_skipped + 1;
      continue;
    end;
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select pr.branch_id, pr.assigned_to into v_branch, v_advisor
      from public.properties pr where pr.id = v_pl.property_id and pr.tenant_id = v_tenant;
    select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
    if not public.lc_row_visible(v_branch, v_team, v_advisor) or (p_scope = 'mine' and v_advisor is distinct from v_uid) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_obs := '{}'::jsonb;
    if jsonb_typeof(j -> 'observed' -> 'price') = 'number' and (j -> 'observed' ->> 'price')::numeric > 0
       and (j -> 'observed' ->> 'price')::numeric < 1e12 then
      v_obs := v_obs || jsonb_build_object('price', j -> 'observed' -> 'price');
    end if;
    if jsonb_typeof(j -> 'observed' -> 'title') = 'string' then
      v_obs := v_obs || jsonb_build_object('title', left(j -> 'observed' ->> 'title', 300));
    end if;
    if jsonb_typeof(j -> 'observed' -> 'advisor_name') = 'string' then
      v_obs := v_obs || jsonb_build_object('advisor_name', left(j -> 'observed' ->> 'advisor_name', 120));
    end if;
    if jsonb_typeof(j -> 'observed' -> 'status') = 'string' then
      v_obs := v_obs || jsonb_build_object('status', left(j -> 'observed' ->> 'status', 40));
    end if;
    v_res := public.lc_apply_check(v_tenant, v_pl.id, j ->> 'result', v_source_kind, null, null, v_obs, null, '{}'::jsonb, null);
    if v_res ->> 'outcome' = 'applied' then
      v_applied := v_applied + 1;
      perform public.lc_mark_state_stale(v_tenant, v_pl.property_id);
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- (b) kayitsiz portal ilanlari -> eslesme adaylari (+ guclu adayda anomali)
  if p_candidates is not null and jsonb_array_length(p_candidates) > 0 then
    v_registered := public.lc_register_matching_candidates(
      v_tenant,
      (select coalesce(jsonb_agg(e || jsonb_build_object('portal', v_portal, 'source_kind', v_source_kind)), '[]'::jsonb)
         from jsonb_array_elements(p_candidates) as e
        where nullif(btrim(e ->> 'external_id'), '') is not null)
    );
    for c in select e from jsonb_array_elements(p_candidates) as e loop
      if nullif(btrim(c ->> 'external_id'), '') is null or jsonb_typeof(c -> 'candidates') <> 'array'
         or jsonb_array_length(c -> 'candidates') = 0 then
        continue;
      end if;
      begin
        v_prop := (c -> 'candidates' -> 0 ->> 'property_id')::uuid;
        v_score := (c -> 'candidates' -> 0 ->> 'score')::numeric;
      exception when others then
        continue;
      end;
      if v_score is null or v_score < 60 then
        continue;
      end if;
      select pr.branch_id, pr.assigned_to into v_branch, v_advisor
        from public.properties pr where pr.id = v_prop and pr.tenant_id = v_tenant and pr.deleted_at is null;
      if not found then
        continue;
      end if;
      select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
      if not public.lc_row_visible(v_branch, v_team, v_advisor) then
        continue;
      end if;
      v_key := left('unregistered_listing:' || v_portal || ':' || lower(btrim(c ->> 'external_id')), 200);
      v_anomaly := null;
      insert into public.listing_anomalies
        (tenant_id, property_id, type, severity, dedupe_key, branch_id, team_id, advisor_id, assignee_id, details, sla_due_at)
      values
        (v_tenant, v_prop, 'unregistered_listing', 'medium', v_key, v_branch, v_team, v_advisor, v_advisor,
         jsonb_build_object('portal', v_portal, 'externalId', left(c ->> 'external_id', 200), 'url', left(c ->> 'url', 2048),
                            'title', left(c ->> 'title', 300), 'price', c -> 'price', 'score', v_score),
         now() + interval '4 hours')
      on conflict (tenant_id, dedupe_key) do nothing
      returning id into v_anomaly;
      if v_anomaly is not null then
        insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, actor_id, note)
        values (v_tenant, v_anomaly, 'opened', v_uid, 'Portal envanterinde kayitsiz ilan');
        v_opened := v_opened + 1;
      else
        update public.listing_anomalies set last_seen_at = now()
         where tenant_id = v_tenant and dedupe_key = v_key and status in ('open', 'acknowledged', 'explained');
      end if;
    end loop;
  end if;

  -- (c) ozet (yalniz son parcada verilir; parcali aktarimda tek kayit)
  if p_summary is not null then
    insert into public.listing_inventory_imports
      (tenant_id, portal, scope, source, complete, actor_id, total_rows, matched, removed, unregistered, never_published,
       id_invalid, unverifiable, other_advisor, price_diff, summary)
    values
      (v_tenant, v_portal, p_scope, p_source, coalesce(p_complete, false), v_uid,
       greatest(coalesce((v_s ->> 'total_rows')::integer, 0), 0), greatest(coalesce((v_s ->> 'matched')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'removed')::integer, 0), 0), greatest(coalesce((v_s ->> 'unregistered')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'never_published')::integer, 0), 0), greatest(coalesce((v_s ->> 'id_invalid')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'unverifiable')::integer, 0), 0), greatest(coalesce((v_s ->> 'other_advisor')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'price_diff')::integer, 0), 0),
       case when pg_column_size(v_s -> 'detail') <= 7000 then coalesce(v_s -> 'detail', '{}'::jsonb) else '{}'::jsonb end)
    returning id into v_import;
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'listing_inventory.import', 'listing_inventory_import', v_import,
            jsonb_build_object('portal', v_portal, 'scope', p_scope, 'source', p_source, 'complete', coalesce(p_complete, false)));
  end if;

  return jsonb_build_object('outcome', 'ok', 'import_id', v_import, 'observations_applied', v_applied,
                            'observations_skipped', v_skipped, 'candidates_registered', v_registered, 'anomalies_opened', v_opened);
end;
$$;

revoke all on function public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb) to authenticated;

alter table public.listing_matching_candidates drop column if exists detail;
alter table public.listing_inventory_imports drop column if exists read_count;
alter table public.listing_inventory_imports drop column if exists expected_count;

notify pgrst, 'reload schema';
