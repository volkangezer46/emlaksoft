-- MIGRATION 20261013002010_portal_rules_rpcs.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261013002010_portal_rules_rpcs.sql` ile uygular (20261013002000 SONRASI).
-- Geri alma: supabase/rollbacks/20261013002010_portal_rules_rpcs.rollback.sql
-- BAGIMLILIK: 20261013002000_portal_rules_core.sql (tablolar, pt_rules_is_operator/_super_admin, pt_rules_validate_content),
--   portal_transfer_sessions (20261012002700), listing_verifications (20260826002020), platform_audit_logs, tenants.
--
-- NE: kullanici oturumuyla (JWT) calisan SECURITY DEFINER RPC'ler. service_role KULLANILMAZ.
--   * pt_rules_current(p_engine): portals/view; portal basina yayindaki (suresi dolmamis) imzali set.
--   * pt_report_form_feedback(p_session_id, p_payload): portals/edit; oturum sahibi + kiraci, <=24 saat, durum filled/published,
--     riza metni surumu >=1, kisisel desen suzgeci (TS'in SQL kopyasi), kiraci basina gunde <=300 rapor satiri ve <=2000 olay
--     satiri, olaylarda yalniz ILERI faz gunceller.
--   * Personel RPC'leri (her biri ONCE rol kapisi, sonra platform_audit_logs satiri): operator = super_admin|ops,
--     yayin/geri alma YALNIZ super_admin (elestirmen K1). Icerik imzasi TS'te (ozel anahtar DB'ye girmez) uretilir; RPC
--     icerigi SQL semasindan gecirir (K2), surum = max+1 zorlar, sha/imza bicimini denetler.
-- RISK: dusuk (yalniz yeni fonksiyonlar).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.portal_rule_sets') is null then
    raise exception 'portal_rule_sets yok; once 20261013002000 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.listing_verifications') is null then
    raise exception 'listing_verifications yok; ilan kontrol tablolari (20260826002020) once uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ortak yardimcilar (RPC degil; disariya kapali)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_feedback_text_ok(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p is not null and p ~ '^[a-z0-9+ ]{1,60}$'
     and p !~ '[0-9]{4,}'
     and length(regexp_replace(p, '[^0-9]', '', 'g')) < 7
     and p !~ 'http' and p !~ 'www'
     and p !~ '(^| )tr ?[0-9]{2}'
     and p !~ '(^| )(sifir|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on) (sifir|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on) (sifir|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)( |$)';
$$;

create or replace function public.pt_feedback_label_personal(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select (' ' || coalesce(p, '') || ' ') ~ ' (iletisim|telefon|tel|cep|gsm|whatsapp|e posta|eposta|mail|email|ad soyad|adi soyadi|adiniz|soyad|soyadi|isim|yetkili|firma|danisman|temsilci|sorumlu|magaza|ofis|sube|kullanici|unvan|tc|kimlik|iban) ';
$$;

create or replace function public.pt_rules_audit(p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_meta jsonb)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.platform_audit_logs (actor_id, action, entity_type, entity_id, meta)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_meta, '{}'::jsonb));
$$;

/** Imzali seti yayina alir (tek yazma yolu). Cagiran rol kapisini kendisi yapar. */
create or replace function public.pt_rules_insert_set(
  p_portal text,
  p_content jsonb,
  p_kind text,
  p_parent uuid,
  p_change_summary jsonb,
  p_sha text,
  p_signature text,
  p_kid text,
  p_actor uuid,
  p_rolls_back_to uuid,
  p_proposal_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reason text;
  v_next integer;
  v_prev uuid;
  v_id uuid;
  v_exp timestamptz;
begin
  if coalesce(p_portal, '') not in ('sahibinden', 'hepsiemlak', 'emlakjet') or coalesce(p_kind, '') not in ('seed', 'auto', 'staff', 'rollback') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  v_reason := public.pt_rules_validate_content(p_portal, p_content);
  if v_reason is not null then
    return jsonb_build_object('outcome', 'invalid_content', 'reason', v_reason);
  end if;
  if p_sha is null or p_sha !~ '^[0-9a-f]{64}$' or p_signature is null or p_signature !~ '^[A-Za-z0-9_-]{80,100}$'
     or p_kid is null or p_kid !~ '^[A-Za-z0-9._-]{1,40}$' then
    return jsonb_build_object('outcome', 'invalid_signature');
  end if;
  if p_change_summary is not null and (jsonb_typeof(p_change_summary) <> 'object' or pg_column_size(p_change_summary) > 16384) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  v_exp := (p_content ->> 'expiresAt')::timestamptz;
  if v_exp <= now() or v_exp > now() + interval '31 days' then
    return jsonb_build_object('outcome', 'invalid_expiry');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pt_rules:' || p_portal, 0));
  select coalesce(max(version), 0) + 1 into v_next from public.portal_rule_sets where portal = p_portal;
  if (p_content ->> 'version')::bigint <> v_next then
    return jsonb_build_object('outcome', 'version_conflict', 'expected', v_next);
  end if;
  if p_parent is not null and not exists (select 1 from public.portal_rule_sets where id = p_parent and portal = p_portal) then
    return jsonb_build_object('outcome', 'invalid_parent');
  end if;
  select id into v_prev from public.portal_rule_sets where portal = p_portal and status = 'published' for update;
  if v_prev is not null then
    update public.portal_rule_sets set status = 'superseded', superseded_at = now() where id = v_prev;
  end if;
  insert into public.portal_rule_sets
    (portal, version, status, kind, content, content_sha256, signature, kid, expires_at, parent_id, rolls_back_to,
     change_summary, min_extension, created_by, published_at)
  values
    (p_portal, v_next, 'published', p_kind, p_content, p_sha, p_signature, p_kid, v_exp, coalesce(p_parent, v_prev),
     p_rolls_back_to, coalesce(p_change_summary, '{}'::jsonb), p_content ->> 'minExtension', p_actor, now())
  returning id into v_id;
  if p_proposal_ids is not null and cardinality(p_proposal_ids) > 0 then
    if p_kind = 'auto' then
      update public.portal_rule_proposals
         set state = 'auto_approved', decided_at = now(), rule_set_id = v_id, decision_reason = 'otomatik (ogrenme)'
       where portal = p_portal and id = any (p_proposal_ids) and state = 'ready' and not ai_unverified;
    else
      update public.portal_rule_proposals
         set rule_set_id = v_id
       where portal = p_portal and id = any (p_proposal_ids) and state = 'approved';
    end if;
  end if;
  return jsonb_build_object('outcome', 'ok', 'id', v_id, 'version', v_next, 'previous_id', v_prev);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Yayindaki setler (eklenti kural ucu)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_current(p_engine text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or public.current_tenant_id() is null or not public.has_effective_permission('portals', 'view') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_engine is distinct from 'f1' then
    return jsonb_build_object('outcome', 'unsupported_engine');
  end if;
  return jsonb_build_object('outcome', 'ok', 'sets', coalesce((
    select jsonb_agg(jsonb_build_object(
             'portal', rs.portal, 'version', rs.version, 'content', rs.content, 'content_sha256', rs.content_sha256,
             'signature', rs.signature, 'kid', rs.kid, 'expires_at', rs.expires_at) order by rs.portal)
      from public.portal_rule_sets rs
     where rs.status = 'published' and rs.expires_at > now()
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Riza ile gelen form geri bildirimi
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_report_form_feedback(p_session_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  s public.portal_transfer_sessions%rowtype;
  v_phase text;
  v_rank integer;
  v_fp text;
  v_rule_version integer;
  v_first boolean;
  v_reports_today integer;
  v_events_today integer;
  v_f jsonb;
  v_sig text;
  v_label text;
  v_control text;
  v_key text;
  v_outcome text;
  v_ckind text;
  v_copt text;
  v_vkey text;
  v_vcat text;
  v_opts text[];
  v_total integer;
  v_kept integer;
  v_existing_phase text;
  v_accepted integer := 0;
  v_dropped integer := 0;
  v_limited integer := 0;
  v_keys text[] := array['title','description','price','currency','gross_sqm','net_sqm','rooms','building_age','floor',
    'total_floors','heating','bathrooms','balcony','elevator','parking','furnished','usage_status','in_site','site_name',
    'dues','credit_eligible','deed_status','facade','swap','eids_property_no','authority_doc_no','parcel_block',
    'parcel_lot','virtual_tour_url'];
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 60000
     or jsonb_typeof(p_payload -> 'fields') <> 'array' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if coalesce(p_payload ->> 'consentTextVersion', '') !~ '^[0-9]{1,4}$' or (p_payload ->> 'consentTextVersion')::integer < 1 then
    return jsonb_build_object('outcome', 'consent_required');
  end if;
  select * into s from public.portal_transfer_sessions
   where id = p_session_id and tenant_id = v_tenant and actor_id = v_uid and direction <> 'import';
  if not found then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if s.created_at < now() - interval '24 hours' then
    return jsonb_build_object('outcome', 'expired');
  end if;
  v_phase := p_payload ->> 'phase';
  if coalesce(v_phase, '') not in ('filled', 'checked', 'published') or (p_payload ->> 'portal') is distinct from s.portal
     or lower(coalesce(p_payload ->> 'sessionId', '')) <> p_session_id::text then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if s.state not in ('filled', 'published') or (v_phase = 'published' and s.state <> 'published') then
    return jsonb_build_object('outcome', 'invalid_state');
  end if;
  v_fp := p_payload ->> 'formFp';
  if v_fp is null or v_fp !~ '^[0-9a-f]{64}$' or coalesce(p_payload ->> 'ruleVersion', '') !~ '^[0-9]{1,10}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  v_rule_version := least((p_payload ->> 'ruleVersion')::bigint, 2147483647)::integer;
  v_rank := case v_phase when 'filled' then 1 when 'checked' then 2 else 3 end;

  perform pg_advisory_xact_lock(hashtextextended('pt_feedback:' || v_tenant::text, 0));
  select count(*) into v_reports_today from public.portal_form_reports where tenant_id = v_tenant and day = current_date;
  select count(*) into v_events_today from public.portal_fill_events where tenant_id = v_tenant and created_at >= date_trunc('day', now());
  v_first := not exists (select 1 from public.portal_fill_events where session_id = s.id);

  for v_f in select value from jsonb_array_elements(p_payload -> 'fields') with ordinality as e(value, i) where i <= 120 loop
    v_sig := v_f ->> 'sig';
    v_label := v_f ->> 'label';
    v_control := v_f ->> 'control';
    v_key := v_f ->> 'key';
    v_outcome := v_f ->> 'outcome';
    if jsonb_typeof(v_f) <> 'object' or v_sig is null or v_sig !~ '^[0-9a-f]{64}$'
       or not public.pt_feedback_text_ok(v_label) or public.pt_feedback_label_personal(v_label)
       or v_control is null or v_control not in ('text', 'number', 'textarea', 'choice', 'bool')
       or (v_key is not null and not (v_key = any (v_keys)))
       or v_outcome is null or v_outcome not in ('filled', 'accepted', 'corrected', 'cleared', 'not_found', 'no_option', 'already_filled', 'unmatched')
       or (v_f ? 'options' and jsonb_typeof(v_f -> 'options') <> 'array') then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    -- Secenekler: kisisel desenli olanlar atilir; %30'dan fazlasi atildiysa liste tumden bosalir.
    select count(*), count(*) filter (where jsonb_typeof(o) = 'string' and public.pt_feedback_text_ok(o #>> '{}')),
           coalesce(array_agg(o #>> '{}') filter (where jsonb_typeof(o) = 'string' and public.pt_feedback_text_ok(o #>> '{}')), '{}')
      into v_total, v_kept, v_opts
      from (select o from jsonb_array_elements(coalesce(v_f -> 'options', '[]'::jsonb)) with ordinality as x(o, j) where j <= 60) q;
    v_dropped := v_dropped + (v_total - v_kept);
    if v_total > 0 and (v_total - v_kept)::numeric / v_total > 0.3 then
      v_opts := '{}';
    end if;
    v_ckind := v_f #>> '{correction,kind}';
    v_copt := null;
    v_vkey := null;
    v_vcat := null;
    if v_ckind is not null then
      if v_ckind = 'other_option' then
        v_copt := v_f #>> '{correction,option}';
        v_vkey := v_f #>> '{correction,valueKey}';
        if v_copt is null or not (v_copt = any (v_opts)) or (v_vkey is not null and v_vkey !~ '^[a-z0-9 ]{1,40}$') then
          v_dropped := v_dropped + 1;
          continue;
        end if;
      elsif v_ckind = 'value_edited' then
        v_vcat := v_f #>> '{correction,category}';
        if v_vcat is null or v_vcat not in ('format', 'rewritten') then
          v_dropped := v_dropped + 1;
          continue;
        end if;
      elsif v_ckind <> 'cleared' then
        v_dropped := v_dropped + 1;
        continue;
      end if;
    end if;

    -- Form semasi (oturum basina bir kez: ilk geri bildirim ya da "filled" fazi)
    if v_first or v_phase = 'filled' then
      if exists (select 1 from public.portal_form_reports
                  where tenant_id = v_tenant and day = current_date and portal = s.portal and fingerprint = v_fp and field_sig = v_sig) then
        update public.portal_form_reports
           set n = least(n + 1, 1000000), label_folded = v_label, options_folded = v_opts, control = v_control,
               required = (case when jsonb_typeof(v_f -> 'required') = 'boolean' then (v_f ->> 'required')::boolean else false end), matched_key = v_key, rule_version = v_rule_version
         where tenant_id = v_tenant and day = current_date and portal = s.portal and fingerprint = v_fp and field_sig = v_sig;
      elsif v_reports_today < 300 then
        insert into public.portal_form_reports
          (tenant_id, day, portal, fingerprint, field_sig, control, label_folded, options_folded, required, matched_key, rule_version, n)
        values
          (v_tenant, current_date, s.portal, v_fp, v_sig, v_control, v_label, v_opts,
           (case when jsonb_typeof(v_f -> 'required') = 'boolean' then (v_f ->> 'required')::boolean else false end), v_key, v_rule_version, 1);
        v_reports_today := v_reports_today + 1;
      else
        v_limited := v_limited + 1;
      end if;
    end if;

    -- Doldurma olayi: yalniz ileri faz gunceller (filled < checked < published)
    select phase into v_existing_phase from public.portal_fill_events where session_id = s.id and field_sig = v_sig;
    if not found then
      if v_events_today < 2000 then
        insert into public.portal_fill_events
          (tenant_id, session_id, portal, rule_version, form_fp, field_key, field_sig, outcome, correction_kind,
           corrected_option_folded, value_key, value_category, phase)
        values
          (v_tenant, s.id, s.portal, v_rule_version, v_fp, v_key, v_sig, v_outcome, v_ckind, v_copt, v_vkey, v_vcat, v_phase);
        v_events_today := v_events_today + 1;
      else
        v_limited := v_limited + 1;
        continue;
      end if;
    elsif (case v_existing_phase when 'filled' then 1 when 'checked' then 2 else 3 end) < v_rank then
      update public.portal_fill_events
         set outcome = v_outcome, correction_kind = v_ckind, corrected_option_folded = v_copt, value_key = v_vkey,
             value_category = v_vcat, phase = v_phase, field_key = coalesce(v_key, field_key), rule_version = v_rule_version,
             form_fp = v_fp, updated_at = now()
       where session_id = s.id and field_sig = v_sig;
    end if;
    v_accepted := v_accepted + 1;
  end loop;
  v_dropped := v_dropped + greatest(jsonb_array_length(p_payload -> 'fields') - 120, 0);
  return jsonb_build_object('outcome', 'ok', 'accepted', v_accepted, 'dropped', v_dropped, 'limited', v_limited);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Personel RPC'leri
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_admin_overview(p_portal text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_out jsonb;
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if coalesce(p_portal, '') not in ('sahibinden', 'hepsiemlak', 'emlakjet') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select jsonb_build_object(
    'outcome', 'ok',
    'portal', p_portal,
    'current', (select jsonb_build_object('id', id, 'version', version, 'kind', kind, 'published_at', published_at,
                                          'expires_at', expires_at, 'content_sha256', content_sha256, 'kid', kid)
                  from public.portal_rule_sets where portal = p_portal and status = 'published'),
    'versions_n', (select count(*) from public.portal_rule_sets where portal = p_portal),
    'proposals', coalesce((select jsonb_object_agg(state, n) from (select state, count(*) n from public.portal_rule_proposals where portal = p_portal group by state) q), '{}'::jsonb),
    'ready_ai_n', (select count(*) from public.portal_rule_proposals where portal = p_portal and state = 'ready' and ai_unverified),
    'fields_n', (select count(*) from public.portal_form_fields where portal = p_portal),
    'unmapped_n', (select count(*) from public.portal_form_fields where portal = p_portal and mapped_key is null),
    'form_alerts', coalesce((select jsonb_object_agg(alert_state, n) from (select alert_state, count(*) n from public.portal_form_versions where portal = p_portal and alert_state <> 'none' group by alert_state) q), '{}'::jsonb),
    'voting_tenants_60d', (select count(distinct v.tenant_id) from public.portal_rule_votes v
                            join public.portal_rule_proposals p on p.proposal_key = v.proposal_key and p.portal = p_portal
                           where v.last_at >= now() - interval '60 days'),
    'eligible_voting_tenants_60d', (select count(distinct v.tenant_id) from public.portal_rule_votes v
                            join public.portal_rule_proposals p on p.proposal_key = v.proposal_key and p.portal = p_portal
                           where v.eligible and v.last_at >= now() - interval '60 days'),
    'trust_overrides', (select count(*) from public.portal_rule_tenant_trust)
  ) into v_out;
  perform public.pt_rules_audit(auth.uid(), 'portal_rules.overview', 'portal_rule_set', null, jsonb_build_object('portal', p_portal));
  return v_out;
end;
$$;

create or replace function public.pt_rules_admin_evidence(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  p public.portal_rule_proposals%rowtype;
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into p from public.portal_rule_proposals where id = p_proposal_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform public.pt_rules_audit(auth.uid(), 'portal_rules.evidence', 'portal_rule_proposal', p.id, jsonb_build_object('portal', p.portal));
  -- Kiraci kimligi/adi YOK: yalniz oy durusu, oturum sayisi, uygunluk ve zaman.
  return jsonb_build_object(
    'outcome', 'ok',
    'proposal', to_jsonb(p),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('stance', v.stance, 'sessions_n', v.sessions_n, 'eligible', v.eligible,
                                                           'first_at', v.first_at, 'last_at', v.last_at) order by v.last_at desc)
                         from public.portal_rule_votes v where v.proposal_key = p.proposal_key), '[]'::jsonb)
  );
end;
$$;

create or replace function public.pt_rules_admin_decide(p_proposal_id uuid, p_decision text, p_reason text, p_pii_confirmed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  p public.portal_rule_proposals%rowtype;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if coalesce(p_decision, '') not in ('approve', 'reject') or (v_reason is not null and length(v_reason) > 500)
     or (p_decision = 'reject' and (v_reason is null or length(v_reason) < 3)) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into p from public.portal_rule_proposals where id = p_proposal_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p.state not in ('collecting', 'ready') then
    return jsonb_build_object('outcome', 'already_decided', 'state', p.state);
  end if;
  -- Y2: tek ofisten gelen metin (etiket/secenek) tum kiracilara imzali kuralla gider; k<2 iken acik onay sart.
  if p_decision = 'approve' and p.kind in ('label_map', 'option_map', 'new_field') and p.support_tenants < 2
     and not coalesce(p_pii_confirmed, false) then
    return jsonb_build_object('outcome', 'pii_confirmation_required');
  end if;
  update public.portal_rule_proposals
     set state = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = v_uid, decision_reason = v_reason
   where id = p.id;
  perform public.pt_rules_audit(v_uid, 'portal_rules.' || p_decision, 'portal_rule_proposal', p.id,
    jsonb_build_object('portal', p.portal, 'kind', p.kind, 'field_key', p.field_key, 'source', p.source,
                       'support_tenants', p.support_tenants, 'pii_confirmed', coalesce(p_pii_confirmed, false), 'reason', v_reason));
  return jsonb_build_object('outcome', 'ok', 'state', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.pt_rules_admin_propose(p_portal text, p_kind text, p_field_key text, p_proposal jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if coalesce(p_portal, '') not in ('sahibinden', 'hepsiemlak', 'emlakjet')
     or coalesce(p_kind, '') not in ('label_map', 'option_map', 'field_demote', 'field_disable', 'new_field', 'form_meta')
     or (p_kind <> 'form_meta' and (p_field_key is null or p_field_key !~ '^[a-z_]{2,40}$'))
     or p_proposal is null or jsonb_typeof(p_proposal) <> 'object' or pg_column_size(p_proposal) > 4096
     or nullif(btrim(coalesce(p_reason, '')), '') is null or length(p_reason) > 500 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  v_key := encode(sha256(convert_to('staff|' || p_kind || '|' || p_portal || '|' || coalesce(p_field_key, '') || '|' || p_proposal::text, 'UTF8')), 'hex');
  insert into public.portal_rule_proposals (portal, proposal_key, kind, field_key, proposal, source, state, decision_reason)
  values (p_portal, v_key, p_kind, p_field_key, p_proposal, 'staff', 'ready', btrim(p_reason))
  on conflict (portal, proposal_key) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('outcome', 'exists');
  end if;
  perform public.pt_rules_audit(v_uid, 'portal_rules.propose', 'portal_rule_proposal', v_id,
    jsonb_build_object('portal', p_portal, 'kind', p_kind, 'field_key', p_field_key));
  return jsonb_build_object('outcome', 'ok', 'id', v_id);
end;
$$;

create or replace function public.pt_rules_admin_publish(
  p_portal text,
  p_content jsonb,
  p_kind text,
  p_parent uuid,
  p_change_summary jsonb,
  p_sha text,
  p_signature text,
  p_kid text,
  p_proposal_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if not public.pt_rules_is_super_admin() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if coalesce(p_kind, '') not in ('seed', 'staff') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  v_res := public.pt_rules_insert_set(p_portal, p_content, p_kind, p_parent, p_change_summary, p_sha, p_signature, p_kid,
                                      v_uid, null, p_proposal_ids);
  perform public.pt_rules_audit(v_uid, 'portal_rules.publish', 'portal_rule_set', nullif(v_res ->> 'id', '')::uuid,
    jsonb_build_object('portal', p_portal, 'kind', p_kind, 'outcome', v_res ->> 'outcome', 'version', v_res -> 'version',
                       'sha', p_sha, 'kid', p_kid));
  return v_res;
end;
$$;

create or replace function public.pt_rules_admin_rollback(
  p_portal text,
  p_to_version integer,
  p_content jsonb,
  p_sha text,
  p_signature text,
  p_kid text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  t public.portal_rule_sets%rowtype;
  v_res jsonb;
begin
  if not public.pt_rules_is_super_admin() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into t from public.portal_rule_sets
   where portal = p_portal and version = p_to_version and published_at is not null;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  -- Geri alma ESKI ICERIKLE yeni (max+1) surum: yalniz surum ve zaman damgalari degisebilir.
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or (p_content - 'version' - 'issuedAt' - 'expiresAt') <> (t.content - 'version' - 'issuedAt' - 'expiresAt') then
    return jsonb_build_object('outcome', 'content_mismatch');
  end if;
  v_res := public.pt_rules_insert_set(p_portal, p_content, 'rollback', null,
                                      jsonb_build_object('rollback_to_version', t.version, 'rollback_to_id', t.id),
                                      p_sha, p_signature, p_kid, v_uid, t.id, null);
  perform public.pt_rules_audit(v_uid, 'portal_rules.rollback', 'portal_rule_set', nullif(v_res ->> 'id', '')::uuid,
    jsonb_build_object('portal', p_portal, 'to_version', t.version, 'outcome', v_res ->> 'outcome', 'version', v_res -> 'version'));
  return v_res;
end;
$$;

create or replace function public.pt_rules_admin_set_trust(p_tenant_id uuid, p_eligible boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_eligible is null or nullif(btrim(coalesce(p_reason, '')), '') is null or length(p_reason) > 500 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  insert into public.portal_rule_tenant_trust (tenant_id, eligible, reason, set_by, set_at)
  values (p_tenant_id, p_eligible, btrim(p_reason), v_uid, now())
  on conflict (tenant_id) do update set eligible = excluded.eligible, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  perform public.pt_rules_audit(v_uid, 'portal_rules.set_trust', 'portal_rule_trust', p_tenant_id,
    jsonb_build_object('eligible', p_eligible, 'reason', btrim(p_reason)));
  return jsonb_build_object('outcome', 'ok');
end;
$$;

-- Y3 "dogrulanmis yayin": ilan kontrol ISCISI (kuyruk isi + istemci; lc_worker_complete) baglanan ilani bagdan en az
-- 1 saat sonra 'present' gormus olmali. portal_listings.last_confirmed_at YETMEZ: ofis 'Teyit et' dugmesiyle
-- (confirmPortalListing / lc_submit_manual_check, source_kind 'manual', job_id null) ya da yayin akisi bu alani yazar.
create or replace function public.pt_rules_worker_seen(p_listing_id uuid, p_after timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.listing_verifications lv
     where lv.portal_listing_id = p_listing_id and lv.checked_at > p_after
       and lv.result = 'present' and lv.job_id is not null and lv.source_kind <> 'manual'
  );
$$;

/** Ofis uygunluk paneli: kiraci adi YALNIZ burada (operator). Varsayilan uygunluk ogrenme adimiyla ayni kurallar. */
create or replace function public.pt_rules_admin_trust_list()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  perform public.pt_rules_audit(auth.uid(), 'portal_rules.trust_list', 'portal_rule_trust', null, '{}'::jsonb);
  return jsonb_build_object('outcome', 'ok', 'tenants', coalesce((
    select jsonb_agg(jsonb_build_object(
             'tenant_id', t.id, 'name', t.name, 'status', t.status, 'sample', t.sample_pack is not null,
             'created_at', t.created_at, 'verified_sessions_60d', coalesce(ps.n, 0),
             'override', case when tr.tenant_id is null then null else jsonb_build_object('eligible', tr.eligible, 'reason', tr.reason, 'set_at', tr.set_at) end,
             'default_eligible', (t.status = 'active' and t.sample_pack is null and t.created_at <= now() - interval '14 days' and coalesce(ps.n, 0) >= 3),
             'eligible', coalesce(tr.eligible, (t.status = 'active' and t.sample_pack is null and t.created_at <= now() - interval '14 days' and coalesce(ps.n, 0) >= 3)))
           order by t.created_at)
      from public.tenants t
      left join public.portal_rule_tenant_trust tr on tr.tenant_id = t.id
      left join lateral (
        select count(*) n from public.portal_transfer_sessions s
          join public.portal_listings pl on pl.id = s.portal_listing_id
         where s.tenant_id = t.id and s.state = 'published' and s.completed_at >= now() - interval '60 days'
           and pl.source_kind = 'assisted' and pl.status = 'live'
           and public.pt_rules_worker_seen(pl.id, s.completed_at + interval '1 hour')
      ) ps on true
  ), '[]'::jsonb));
end;
$$;

/** AI onerilerini kaydeder (TS'te dogrulanmis; burada bicim tekrar denetlenir). Kaynak 'ai', ai_unverified=true, durum 'ready'.
 *  Cagirandan YALNIZ (field_sig, field_key, confidence) alinir: etiket ve destek (support_tenants) portal_form_fields
 *  katalogundan okunur (acik metin k>=2, eslenmemis alan). Katalogda olmayan imza atlanir (Y2 / O6 SQL'de de). */
create or replace function public.pt_rules_admin_record_ai(p_portal text, p_model text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_i jsonb;
  v_key text;
  v_n integer := 0;
  v_skipped integer := 0;
  v_id uuid;
  v_label text;
  v_support integer;
  v_keys text[] := array['title','description','price','currency','gross_sqm','net_sqm','rooms','building_age','floor',
    'total_floors','heating','bathrooms','balcony','elevator','parking','furnished','usage_status','in_site','site_name',
    'dues','credit_eligible','deed_status','facade','swap','eids_property_no','authority_doc_no','parcel_block',
    'parcel_lot','virtual_tour_url'];
begin
  if not public.pt_rules_is_operator() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if coalesce(p_portal, '') not in ('sahibinden', 'hepsiemlak', 'emlakjet') or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 40 or length(coalesce(p_model, '')) > 80 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  for v_i in select * from jsonb_array_elements(p_items) loop
    v_label := null;
    v_support := null;
    if jsonb_typeof(v_i) = 'object' and coalesce(v_i ->> 'field_sig', '') ~ '^[0-9a-f]{64}$' then
      select f.label_folded, f.distinct_tenants into v_label, v_support
        from public.portal_form_fields f
       where f.portal = p_portal and f.field_sig = v_i ->> 'field_sig'
         and f.label_folded is not null and f.distinct_tenants >= 2 and f.mapped_key is null;
    end if;
    if v_label is null or not (coalesce(v_i ->> 'field_key', '') = any (v_keys))
       or not public.pt_feedback_text_ok(v_label) or public.pt_feedback_label_personal(v_label)
       or length(v_label) < 3
       or (v_i ->> 'field_key') in ('price', 'currency', 'deed_status', 'credit_eligible', 'swap', 'eids_property_no', 'authority_doc_no') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_key := encode(sha256(convert_to('label_map|' || p_portal || '|' || (v_i ->> 'field_key') || '|' || v_label || '|' || left(v_i ->> 'field_sig', 16), 'UTF8')), 'hex');
    insert into public.portal_rule_proposals
      (portal, proposal_key, kind, field_key, field_sig, proposal, source, support_tenants, confidence, state, ai_model, ai_unverified)
    values
      (p_portal, v_key, 'label_map', v_i ->> 'field_key', v_i ->> 'field_sig',
       jsonb_build_object('label', v_label, 'anchor', left(v_i ->> 'field_sig', 16)), 'ai',
       v_support,
       (case when jsonb_typeof(v_i -> 'confidence') = 'number' then least(greatest((v_i ->> 'confidence')::numeric, 0), 1) else 0 end), 'ready', nullif(p_model, ''), true)
    on conflict (portal, proposal_key) do nothing
    returning id into v_id;
    if v_id is not null then v_n := v_n + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  perform public.pt_rules_audit(v_uid, 'ai.portal_rule_suggest.record', 'portal_rule_ai', null,
    jsonb_build_object('portal', p_portal, 'model', p_model, 'created', v_n, 'skipped', v_skipped));
  return jsonb_build_object('outcome', 'ok', 'created', v_n, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function public.pt_feedback_text_ok(text) from public, anon, authenticated;
revoke all on function public.pt_feedback_label_personal(text) from public, anon, authenticated;
revoke all on function public.pt_rules_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pt_rules_worker_seen(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.pt_rules_insert_set(text, jsonb, text, uuid, jsonb, text, text, text, uuid, uuid, uuid[]) from public, anon, authenticated;

revoke all on function public.pt_rules_current(text) from public, anon;
revoke all on function public.pt_report_form_feedback(uuid, jsonb) from public, anon;
revoke all on function public.pt_rules_admin_overview(text) from public, anon;
revoke all on function public.pt_rules_admin_evidence(uuid) from public, anon;
revoke all on function public.pt_rules_admin_decide(uuid, text, text, boolean) from public, anon;
revoke all on function public.pt_rules_admin_propose(text, text, text, jsonb, text) from public, anon;
revoke all on function public.pt_rules_admin_publish(text, jsonb, text, uuid, jsonb, text, text, text, uuid[]) from public, anon;
revoke all on function public.pt_rules_admin_rollback(text, integer, jsonb, text, text, text) from public, anon;
revoke all on function public.pt_rules_admin_set_trust(uuid, boolean, text) from public, anon;
revoke all on function public.pt_rules_admin_trust_list() from public, anon;
revoke all on function public.pt_rules_admin_record_ai(text, text, jsonb) from public, anon;

grant execute on function public.pt_rules_current(text) to authenticated;
grant execute on function public.pt_report_form_feedback(uuid, jsonb) to authenticated;
grant execute on function public.pt_rules_admin_overview(text) to authenticated;
grant execute on function public.pt_rules_admin_evidence(uuid) to authenticated;
grant execute on function public.pt_rules_admin_decide(uuid, text, text, boolean) to authenticated;
grant execute on function public.pt_rules_admin_propose(text, text, text, jsonb, text) to authenticated;
grant execute on function public.pt_rules_admin_publish(text, jsonb, text, uuid, jsonb, text, text, text, uuid[]) to authenticated;
grant execute on function public.pt_rules_admin_rollback(text, integer, jsonb, text, text, text) to authenticated;
grant execute on function public.pt_rules_admin_set_trust(uuid, boolean, text) to authenticated;
grant execute on function public.pt_rules_admin_trust_list() to authenticated;
grant execute on function public.pt_rules_admin_record_ai(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
