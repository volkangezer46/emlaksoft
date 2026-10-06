-- MIGRATION 20261007000210_lc_inventory_matching.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000210_lc_inventory_matching.sql` ile uygular (PB46, 000200'den SONRA).
-- Geri alma: supabase/rollbacks/20261007000210_lc_inventory_matching.rollback.sql
-- BAGIMLILIK: 20260826002000 (lc_bind_portal_listing), 20260826002030 (listing_anomalies, listing_matching_candidates),
--   20260826002050 (lc_apply_check), 20260826002060 (lc_register_matching_candidates, lc_decide_matching_candidate),
--   20260826002040 (lc_mark_state_stale).
--
-- AMAC: portal ENVANTERI ICE AKTARMA ve ESLESME KUYRUGU kullanici oturumuyla (JWT) calissin; yeni service_role
-- (createAdminClient) kullanimi YOK. Iki authenticated RPC mevcut service_role cekirdeklerini SARAR:
--   lc_inventory_import  envanter karsilastirmasinin (src/lib/listing-control/inventory-import.ts, SAF) sonucunu yazar:
--     (a) CRM'de canli ilanlar icin gozlem: listede VAR -> 'present' (+fiyat/baslik/danisman), listede YOK -> 'absent'
--         YALNIZ kullanici "liste tam" onayi verdiyse (p_complete). Durum makinesi (lc_apply_check) degismez: tek kayitli
--         dosya gozlemi kaybi ONAYLAMAZ (yetkili kaynak 2 gozlem ister, asgari ara 10 dk).
--     (b) CRM'de olmayan portal ilanlari -> eslesme adayi (lc_register_matching_candidates) + en iyi aday portfoy guveni
--         >= 60 ise o portfoyde 'unregistered_listing' anomalisi (listing_anomalies.property_id NOT NULL oldugundan
--         adaysiz kayitsiz ilan anomali DEGIL, eslesme kuyrugunda "eslesen portfoy yok" olarak durur).
--     (c) listing_inventory_imports: karsilastirma ozeti (sonuc karti + gecmis).
--   lc_match_decide      eslesme kuyrugu karari: 'link' portal ilanini portfoye baglar (lc_bind_portal_listing,
--     created_via='matching'), 'ignore' reddeder; ilgili 'unregistered_listing' anomalisi kapanir.
-- Yetki: portals/edit + satir kapsami (lc_row_visible). Ofis kapsamli ice aktarma ve eslesme karari yonetim kademesi
-- (owner/gm/branch_manager); danisman yalniz "benim portfoylerim" kapsaminda aktarir.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.listing_matching_candidates') is null
     or pg_catalog.to_regclass('public.listing_anomalies') is null
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_apply_check')
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_bind_portal_listing')
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_register_matching_candidates') then
    raise exception 'ilan kontrol cekirdegi yok; once 20260826002000..002060 uygulanmali.';
  end if;
end $$;

create table if not exists public.listing_inventory_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  portal text not null check (portal ~ '^[a-z0-9-]{2,40}$'),
  scope text not null check (scope in ('mine', 'office')),
  source text not null check (source in ('csv', 'paste', 'extension')),
  complete boolean not null default false,
  actor_id uuid,
  total_rows integer not null default 0 check (total_rows >= 0),
  matched integer not null default 0 check (matched >= 0),
  removed integer not null default 0 check (removed >= 0),
  unregistered integer not null default 0 check (unregistered >= 0),
  never_published integer not null default 0 check (never_published >= 0),
  id_invalid integer not null default 0 check (id_invalid >= 0),
  unverifiable integer not null default 0 check (unverifiable >= 0),
  other_advisor integer not null default 0 check (other_advisor >= 0),
  price_diff integer not null default 0 check (price_diff >= 0),
  summary jsonb not null default '{}'::jsonb check (pg_column_size(summary) <= 8192),
  created_at timestamptz not null default now()
);
create index if not exists idx_listing_inventory_imports_tenant on public.listing_inventory_imports (tenant_id, created_at desc);

alter table public.listing_inventory_imports enable row level security;
drop policy if exists listing_inventory_imports_select on public.listing_inventory_imports;
create policy listing_inventory_imports_select on public.listing_inventory_imports for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (actor_id = (select auth.uid()) or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager'))
);
revoke all on table public.listing_inventory_imports from public, anon, authenticated;
grant select on table public.listing_inventory_imports to authenticated;
grant all on table public.listing_inventory_imports to service_role;

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

create or replace function public.lc_match_decide(p_candidate_id uuid, p_action text, p_property_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  c public.listing_matching_candidates%rowtype;
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
  v_bind jsonb;
  v_listing uuid;
  v_key text;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit')
     or coalesce(public.current_profile_role(), '') not in ('owner', 'gm', 'branch_manager') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_action not in ('link', 'ignore') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into c from public.listing_matching_candidates
   where id = p_candidate_id and tenant_id = v_tenant and status = 'open' for update;
  if not found then
    return jsonb_build_object('outcome', 'not_open');
  end if;
  v_key := left('unregistered_listing:' || lower(btrim(c.portal)) || ':' || lower(btrim(c.external_id)), 200);

  if p_action = 'link' then
    if p_property_id is null then
      return jsonb_build_object('outcome', 'invalid_input');
    end if;
    select pr.branch_id, pr.assigned_to into v_branch, v_advisor
      from public.properties pr where pr.id = p_property_id and pr.tenant_id = v_tenant and pr.deleted_at is null;
    if not found then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
    if not public.lc_row_visible(v_branch, v_team, v_advisor) then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    -- Portal adi ekrandaki yazimla ayni kaydedilir ("Sahibinden", "Hepsiemlak", "Emlakjet"); karsilastirmalar zaten kucuk harfli.
    v_bind := public.lc_bind_portal_listing(v_tenant, v_uid, p_property_id, initcap(c.portal), c.external_id, c.url, c.source_kind, 'matching');
    if v_bind ->> 'outcome' not in ('applied', 'replay') then
      return jsonb_build_object('outcome', coalesce(v_bind ->> 'outcome', 'bind_failed'));
    end if;
    v_listing := (v_bind ->> 'listing_id')::uuid;
    perform public.lc_decide_matching_candidate(v_tenant, c.id, 'linked', v_uid, v_listing);
    perform public.lc_mark_state_stale(v_tenant, p_property_id);
  else
    perform public.lc_decide_matching_candidate(v_tenant, c.id, 'ignored', v_uid, null);
  end if;

  with closed as (
    update public.listing_anomalies set status = 'resolved', resolved_at = now()
     where tenant_id = v_tenant and dedupe_key = v_key and status in ('open', 'acknowledged', 'explained')
    returning id
  )
  insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, actor_id, note)
  select v_tenant, id, 'resolved', v_uid, case when p_action = 'link' then 'Eslesme onaylandi' else 'Eslesme reddedildi' end
    from closed;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'listing_match.' || p_action, 'listing_matching_candidate', c.id,
          jsonb_build_object('portal', c.portal, 'external_id', c.external_id, 'property_id', p_property_id, 'listing_id', v_listing));
  return jsonb_build_object('outcome', 'ok', 'listing_id', v_listing);
end;
$$;

revoke all on function public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.lc_match_decide(uuid, text, uuid) from public, anon;
grant execute on function public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.lc_match_decide(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
