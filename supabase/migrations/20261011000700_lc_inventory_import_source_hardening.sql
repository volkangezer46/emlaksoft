-- MIGRATION 20261011000700_lc_inventory_import_source_hardening.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261011000700_lc_inventory_import_source_hardening.sql` ile uygular (20261010000500'dan SONRA).
-- Geri alma: supabase/rollbacks/20261011000700_lc_inventory_import_source_hardening.rollback.sql
--
-- AMAC (konsey #53): danisman kendi ilanlari icin yukledigi dosya/yapistirma ile kacak sinyalini KAPATAMASIN.
--   * scope='mine' iken csv/paste kaynagi 'assisted' sayilir (3 gozlem, guven 0.70); 'csv' (otoriter, 0.85) yalniz ofis geneli.
--   * 'assisted' kaynakli 'yok' gozlemi icin 12 saat araligi artik yalniz eklentiye degil tum 'assisted' gozlemlere uygulanir.
--   * scope='mine' + 'present' (csv/paste/extension, tutarli) + ilan acik kayip durumunda (suspect/probable_missing/confirmed_missing)
--     VEYA acik portal_missing anomalisi varsa (durum unverifiable/paused olsa da): gozlem UYGULANMAZ, portal_missing anomalisine 'escalated' (yonetici onayi bekliyor) adimi dusulur; donusde observations_held.
--   * "liste tam" (complete=true) icin expected/read sayisi TUM kaynaklarda aranir (read >= expected > 0), aksi halde 'absent' yazilmaz.
-- Imza, yetki ve RLS degismez (create or replace; security definer + search_path='').

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'lc_inventory_import')
     or not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = pg_catalog.to_regclass('public.listing_inventory_imports') and a.attname = 'expected_count' and not a.attisdropped) then
    raise exception 'lc_inventory_import/expected_count yok; once 20261010000500 uygulanmali.';
  end if;
end $$;

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
  v_expected integer;
  v_read integer;
  v_complete boolean := coalesce(p_complete, false);
  v_last_absent timestamptz;
  v_detail jsonb;
  v_held integer := 0;
  v_state text;
  v_open_anomaly uuid;
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
  -- Eklentinin magaza sayfasindan okudugu liste kullanici destekli gozlemdir (3 gozlem ister). Dosya/yapistirma YALNIZ ofis
  -- geneli (yonetim kademesi) iken yetkili kaynaktir; danisman kendi ilanlari icin yukledigi dosya/yapistirma 'assisted' (0.70) sayilir:
  -- ilanin sahibi kendi kaydinin kaniti olamaz.
  v_source_kind := case when p_source = 'extension' or p_scope = 'mine' then 'assisted' else 'csv' end;

  -- Tam liste kaniti (TUM kaynaklar): portalin gosterdigi toplam ilan sayisi okunmadan "liste tam" kabul edilmez.
  begin
    v_expected := nullif(v_s ->> 'expected_count', '')::integer;
    v_read := nullif(v_s ->> 'read_count', '')::integer;
  exception when others then
    v_expected := null;
    v_read := null;
  end;
  if v_complete
     and (v_expected is null or v_read is null or v_expected <= 0 or v_read < v_expected) then
    v_complete := false;
  end if;

  -- (a) CRM canli ilan gozlemleri
  for j in select e from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb)) as e loop
    if j ->> 'result' not in ('present', 'absent') or (j ->> 'result' = 'absent' and not v_complete) then
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
    -- "Ilan kalkti" tek taramayla olmaz: 'assisted' kaynakli 'yok' son 'yok'tan en az 12 saat sonra sayilir.
    if j ->> 'result' = 'absent' and v_source_kind = 'assisted' then
      select h.last_absent_at into v_last_absent from public.portal_listing_health h
       where h.portal_listing_id = v_pl.id and h.tenant_id = v_tenant;
      if v_last_absent is not null and v_last_absent > now() - interval '12 hours' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;
    -- Danisman (scope='mine') kendi ilaninda ACIK kacak sinyalini 'var' gozlemiyle KAPATAMAZ. Tutma kosulu iki kaynaklidir:
    -- (1) saglik durumu supheli/olasi/onayli kayip, VEYA (2) ilanin acik/ustlenilmis/aciklanmis 'portal_missing' anomalisi var
    -- (durum unverifiable/paused olsa bile). Kaynak ne olursa olsun (csv/paste/extension) ayni kural: scope='mine' tum
    -- 'assisted' gozlemler icin tutulur -- eklenti de danismanin kendi tarayicisindan gelir, ilan sahibi kendi kaydinin kaniti olamaz.
    -- Gozlem uygulanmaz; anomaliye "yonetici onayi bekliyor" adimi dusulur (yonetici kapatir). Ofis geneli (yonetim) etkilenmez.
    if j ->> 'result' = 'present' and p_scope = 'mine' then
      select h.check_state into v_state from public.portal_listing_health h
       where h.portal_listing_id = v_pl.id and h.tenant_id = v_tenant;
      v_open_anomaly := null;
      select a.id into v_open_anomaly from public.listing_anomalies a
       where a.tenant_id = v_tenant and a.type = 'portal_missing' and a.status in ('open', 'acknowledged', 'explained')
         and (a.portal_listing_id = v_pl.id or a.property_id = v_pl.property_id)
       order by a.last_seen_at desc limit 1;
      if v_state in ('suspect', 'probable_missing', 'confirmed_missing') or v_open_anomaly is not null then
        v_held := v_held + 1;
        if v_open_anomaly is not null and not exists (
             select 1 from public.listing_anomaly_actions x
              where x.anomaly_id = v_open_anomaly and x.tenant_id = v_tenant and x.action = 'escalated'
                and x.created_at > now() - interval '12 hours') then
          insert into public.listing_anomaly_actions (tenant_id, anomaly_id, action, actor_id, note)
          values (v_tenant, v_open_anomaly, 'escalated', v_uid, 'Danisman dosyada ilani gorundu olarak bildirdi; yonetici onayi bekliyor');
        end if;
        continue;
      end if;
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
      if nullif(btrim(c ->> 'external_id'), '') is null then
        continue;
      end if;
      -- Ayrinti (m2, oda, konum metni, danisman): yalniz bilinen anahtarlar, kisa metin; gunluk yeniden siralama kullanir.
      if jsonb_typeof(c -> 'detail') = 'object' then
        v_detail := '{}'::jsonb;
        if jsonb_typeof(c -> 'detail' -> 'sqm') = 'number' then
          v_detail := v_detail || jsonb_build_object('sqm', c -> 'detail' -> 'sqm');
        end if;
        if jsonb_typeof(c -> 'detail' -> 'rooms') = 'string' then
          v_detail := v_detail || jsonb_build_object('rooms', left(c -> 'detail' ->> 'rooms', 12));
        end if;
        if jsonb_typeof(c -> 'detail' -> 'location') = 'string' then
          v_detail := v_detail || jsonb_build_object('location', left(c -> 'detail' ->> 'location', 160));
        end if;
        if jsonb_typeof(c -> 'detail' -> 'advisor') = 'string' then
          v_detail := v_detail || jsonb_build_object('advisor', left(c -> 'detail' ->> 'advisor', 120));
        end if;
        update public.listing_matching_candidates set detail = v_detail
         where tenant_id = v_tenant and portal = v_portal and external_id = c ->> 'external_id' and status = 'open';
      end if;
      if jsonb_typeof(c -> 'candidates') <> 'array' or jsonb_array_length(c -> 'candidates') = 0 then
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
       id_invalid, unverifiable, other_advisor, price_diff, summary, expected_count, read_count)
    values
      (v_tenant, v_portal, p_scope, p_source, v_complete, v_uid,
       greatest(coalesce((v_s ->> 'total_rows')::integer, 0), 0), greatest(coalesce((v_s ->> 'matched')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'removed')::integer, 0), 0), greatest(coalesce((v_s ->> 'unregistered')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'never_published')::integer, 0), 0), greatest(coalesce((v_s ->> 'id_invalid')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'unverifiable')::integer, 0), 0), greatest(coalesce((v_s ->> 'other_advisor')::integer, 0), 0),
       greatest(coalesce((v_s ->> 'price_diff')::integer, 0), 0),
       case when pg_column_size(v_s -> 'detail') <= 7000 then coalesce(v_s -> 'detail', '{}'::jsonb) else '{}'::jsonb end,
       case when v_expected between 0 and 100000 then v_expected end,
       case when v_read between 0 and 100000 then v_read end)
    returning id into v_import;
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'listing_inventory.import', 'listing_inventory_import', v_import,
            jsonb_build_object('portal', v_portal, 'scope', p_scope, 'source', p_source, 'complete', v_complete));
  end if;

  return jsonb_build_object('outcome', 'ok', 'import_id', v_import, 'observations_applied', v_applied,
                            'observations_skipped', v_skipped, 'observations_held', v_held, 'candidates_registered', v_registered, 'anomalies_opened', v_opened,
                            'complete', v_complete);
end;
$$;

revoke all on function public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
