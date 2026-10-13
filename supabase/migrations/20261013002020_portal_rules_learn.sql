-- MIGRATION 20261013002020_portal_rules_learn.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261013002020_portal_rules_learn.sql` ile uygular (20261013002000 ve 002010 SONRASI).
-- Geri alma: supabase/rollbacks/20261013002020_portal_rules_learn.rollback.sql
-- BAGIMLILIK: 20261013002000 (tablolar), 20261013002010 (pt_rules_insert_set, pt_rules_audit, pt_rules_worker_seen),
--   portal_listings, listing_verifications, portal_transfer_sessions, tenants, platform_settings, platform_staff, platform_notifications.
--
-- NE: operational-retention cron'unun iki adimi icin YALNIZ service_role fonksiyonlari:
--   * pt_rules_learn(p_now): ofis uygunlugu, oylar (ofis basina tek oy), Wilson alt siniri (z=1,645), oneri durumlari,
--     geriletme adaylari, alan katalogu (k>=2 acik metin), form surumleri ve "form degisti" uyarisi. Ozet jsonb doner;
--     yeni surum URETMEZ (TS: applyProposals + validateRuleSet + imza + pt_rules_publish_system).
--   * pt_rules_publish_system(...): otomatik yayin (kind 'auto'), actor null + meta.system='learner', personele bildirim.
--   * pt_rules_mark_invalid(ids, reason): otomatik yayinda uygulanamayan (risky_key, label_shared, ...) oneriyi 'rejected'
--     yapar; boylece her gece yeniden secilip portalin tum partisini dusurmez.
--   * pt_learning_retention(p_now): saklama sureleri (olay 180, rapor 90, oy 180 gun; reddedilen/suresi dolan/yerine
--     yenisi gelen oneri, katalog ve form surumleri 1 yil).
-- ZEHIRLEMEYE KARSI (elestirmen Y3/Y4/O3): yalniz DOGRULANMIS yayin oturumlari oy uretir (eklentinin bagladigi
--   'assisted' ilan, canli, ilan kontrol ISCISI (kuyruk isi; listing_verifications job_id dolu, kaynak manual degil) bagdan
--   en az 1 saat sonra 'present' gormus; ofisin elle "Teyit et"i / last_confirmed_at SAYILMAZ); uygun olmayan ofisin oyu 0;
--   riskli anahtarlar (price, currency, deed_status, ...) icin etiket/secenek onerisi uretilmez (rule-apply risky_key);
--   ofis basina gunde <=20 oneri; geriletmede yalniz uygun ofisler sayilir ve haftada en cok 3 otomatik geriletme;
--   esikler platform_settings'ten (portal_rules.*), yoksa varsayilan (auto_publish=false, auto_degrade=false).
-- RISK: dusuk (yalniz yeni fonksiyonlar; service_role disinda kimseye acik degil).

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'pt_rules_insert_set')
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'pt_rules_worker_seen') then
    raise exception 'pt_rules_insert_set / pt_rules_worker_seen yok; once 20261013002010 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.platform_settings') is null or pg_catalog.to_regclass('public.platform_notifications') is null
     or pg_catalog.to_regclass('public.portal_listings') is null then
    raise exception 'platform_settings / platform_notifications / portal_listings yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ayar okuyuculari (registry: src/lib/settings/registry/platform.ts; deger metin)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_setting_int(p_key text, p_default integer, p_min integer, p_max integer)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case when btrim(ps.value) ~ '^[0-9]{1,6}$' and btrim(ps.value)::integer between p_min and p_max then btrim(ps.value)::integer end
      from public.platform_settings ps where ps.key = p_key
  ), p_default);
$$;

create or replace function public.pt_rules_setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case when lower(btrim(ps.value)) in ('on', 'true', '1') then true
                when lower(btrim(ps.value)) in ('off', 'false', '0') then false end
      from public.platform_settings ps where ps.key = p_key
  ), p_default);
$$;

create or replace function public.pt_wilson_lb(p_pos integer, p_n integer)
returns numeric
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case when coalesce(p_n, 0) <= 0 then 0::numeric else round((
    (p_pos::numeric / p_n + 2.706025 / (2 * p_n)
     - 1.645 * sqrt((p_pos::numeric / p_n) * (1 - p_pos::numeric / p_n) / p_n + 2.706025 / (4 * p_n::numeric * p_n)))
    / (1 + 2.706025 / p_n))::numeric, 3) end;
$$;

-- Ofis uygunlugu: elle karar (trust) > varsayilan (aktif + ornek veri yok + >=14 gun + son 60 gunde >=3 dogrulanmis yayin).
create or replace function public.pt_rules_eligible_tenants(p_now timestamptz)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(t.id), '{}')
    from public.tenants t
    left join public.portal_rule_tenant_trust tr on tr.tenant_id = t.id
    left join lateral (
      select count(*) n from public.portal_transfer_sessions s
        join public.portal_listings pl on pl.id = s.portal_listing_id
       where s.tenant_id = t.id and s.state = 'published' and s.completed_at >= p_now - interval '60 days'
         and pl.source_kind = 'assisted' and pl.status = 'live'
         and public.pt_rules_worker_seen(pl.id, s.completed_at + interval '1 hour')
    ) ps on true
   where coalesce(tr.eligible, t.status = 'active' and t.sample_pack is null and t.created_at <= p_now - interval '14 days' and ps.n >= 3);
$$;

-- Riskli anahtarlar (TS RISKY_FIELD_KEYS kopyasi): uzak veri bunlara etiket/capa/secenek ekleyemez; oneri uretilmez.
create or replace function public.pt_rules_risky_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  select array['price', 'currency', 'deed_status', 'credit_eligible', 'swap', 'eids_property_no', 'authority_doc_no']::text[];
$$;

-- Kanit satirlari: dogrulanmis yayin oturumlarinin doldurma olaylarindan (son 60 gun) oneri anahtari basina ofis kaniti.
create or replace function public.pt_rules_learn_evidence(p_now timestamptz, p_eligible uuid[])
returns table (
  portal text, kind text, field_key text, field_sig text, proposal jsonb, proposal_key text,
  tenant_id uuid, session_id uuid, ok integer, bad integer, at timestamptz, eligible boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with sess as (
    select s.id, s.tenant_id, s.completed_at
      from public.portal_transfer_sessions s
      join public.portal_listings pl on pl.id = s.portal_listing_id
     where s.state = 'published' and s.completed_at >= p_now - interval '60 days' and s.completed_at <= p_now
       and pl.source_kind = 'assisted' and pl.status = 'live'
         and public.pt_rules_worker_seen(pl.id, s.completed_at + interval '1 hour')
  ),
  ev as (
    -- (a) alan imzasi -> anahtar (capa): kabul / bicim duzeltmesi / secenek duzeltmesi alanin dogru oldugunu gosterir;
    --     temizleme ya da yeniden yazma alanin yanlis oldugunu gosterir.
    select e.portal, 'label_map'::text as kind, e.field_key, e.field_sig,
           jsonb_build_object('anchor', left(e.field_sig, 16)) as proposal,
           encode(sha256(convert_to('label_map|' || e.portal || '|' || e.field_key || '|' || left(e.field_sig, 16), 'UTF8')), 'hex') as proposal_key,
           e.tenant_id, e.session_id,
           case when e.outcome = 'accepted' or e.correction_kind = 'other_option' or e.value_category = 'format' then 1 else 0 end as ok,
           case when e.outcome = 'cleared' or e.value_category = 'rewritten' then 1 else 0 end as bad,
           coalesce(e.updated_at, e.created_at) as at
      from public.portal_fill_events e join sess on sess.id = e.session_id
     where e.field_key is not null and e.outcome in ('accepted', 'corrected', 'cleared')
       and not (e.field_key = any (public.pt_rules_risky_keys()))
    union all
    -- (b) secenek takma adi: ayni EmlakSoft degeri icin kullanicinin sectigi portal secenegi; baska secenek = karsi kanit.
    select e.portal, 'option_map', e.field_key, null::text,
           jsonb_build_object('value', a.value_key, 'alias', a.alias),
           encode(sha256(convert_to('option_map|' || e.portal || '|' || e.field_key || '|' || a.value_key || '|' || a.alias, 'UTF8')), 'hex'),
           e.tenant_id, e.session_id,
           case when e.corrected_option_folded = a.alias then 1 else 0 end,
           case when e.corrected_option_folded <> a.alias then 1 else 0 end,
           coalesce(e.updated_at, e.created_at)
      from public.portal_fill_events e join sess on sess.id = e.session_id
      join (select distinct x.portal, x.field_key, x.value_key, x.corrected_option_folded as alias
              from public.portal_fill_events x join sess on sess.id = x.session_id
             where x.correction_kind = 'other_option' and x.value_key is not null and x.corrected_option_folded is not null
               and x.field_key is not null) a
        on a.portal = e.portal and a.field_key = e.field_key and a.value_key = e.value_key
     where e.correction_kind = 'other_option' and e.value_key is not null and e.corrected_option_folded is not null
       and not (e.field_key = any (public.pt_rules_risky_keys()))
  ),
  capped as (
    -- Ofis basina gunde en cok 20 farkli oneri etkilenir.
    select ev.*, dense_rank() over (partition by ev.tenant_id, (ev.at at time zone 'UTC')::date order by ev.proposal_key) as rk
      from ev
  )
  select c.portal, c.kind, c.field_key, c.field_sig, c.proposal, c.proposal_key, c.tenant_id, c.session_id, c.ok, c.bad, c.at,
         c.tenant_id = any (p_eligible)
    from capped c where c.rk <= 20;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ogrenme adimi
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_learn(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_min_tenants integer := public.pt_rules_setting_int('portal_rules.min_tenants', 3, 1, 10);
  v_min_sessions integer := public.pt_rules_setting_int('portal_rules.min_sessions', 6, 1, 1000);
  v_auto_publish boolean := public.pt_rules_setting_bool('portal_rules.auto_publish', false);
  v_auto_degrade boolean := public.pt_rules_setting_bool('portal_rules.auto_degrade', false);
  v_eligible uuid[] := public.pt_rules_eligible_tenants(p_now);
  v_votes integer := 0;
  v_expired integer := 0;
  v_demotes_week integer;
  v_alerts integer := 0;
begin
  -- 1) Oneriler (ilk gorulme) + oylar (ofis basina tek oy; sessions_n 20'de kesilir)
  insert into public.portal_rule_proposals (portal, proposal_key, kind, field_key, field_sig, proposal, source, first_seen, last_evaluated)
  select distinct on (e.portal, e.proposal_key) e.portal, e.proposal_key, e.kind, e.field_key, e.field_sig, e.proposal, 'corrections', p_now, p_now
    from public.pt_rules_learn_evidence(p_now, v_eligible) e
   order by e.portal, e.proposal_key
  on conflict (portal, proposal_key) do update set last_evaluated = excluded.last_evaluated;

  with agg as (
    select e.proposal_key, e.tenant_id, bool_or(e.eligible) as eligible,
           count(distinct e.session_id) as sessions_n, sum(e.ok) as ok, sum(e.bad) as bad, min(e.at) as first_at, max(e.at) as last_at
      from public.pt_rules_learn_evidence(p_now, v_eligible) e
     group by e.proposal_key, e.tenant_id
  ),
  up as (
    insert into public.portal_rule_votes (proposal_key, tenant_id, stance, sessions_n, first_at, last_at, eligible)
    select a.proposal_key, a.tenant_id,
           case when a.sessions_n < 2 or a.ok + a.bad = 0 then 0
                when a.ok::numeric / (a.ok + a.bad) >= 0.8 then 1
                when a.ok::numeric / (a.ok + a.bad) <= 0.5 then -1
                else 0 end,
           least(a.sessions_n, 20), a.first_at, a.last_at, a.eligible
      from agg a
    on conflict (proposal_key, tenant_id) do update
      set stance = excluded.stance, sessions_n = excluded.sessions_n, last_at = excluded.last_at, eligible = excluded.eligible
    returning 1
  )
  select count(*) into v_votes from up;

  -- Uygunluk degisirse eski oylarin bayragi da guncellenir (uygun olmayan ofisin oyu sayilmaz).
  update public.portal_rule_votes v set eligible = (v.tenant_id = any (v_eligible)) where v.eligible is distinct from (v.tenant_id = any (v_eligible));

  -- 2) Oneri sayilari, Wilson guveni, durum (yalniz ofis kanitli, kararsiz oneriler)
  with weeks as (
    select e.proposal_key, e.portal, count(distinct date_trunc('week', e.at)) as w
      from public.pt_rules_learn_evidence(p_now, v_eligible) e
     where e.eligible and e.ok > 0
     group by e.proposal_key, e.portal
  ),
  stats as (
    select p.id,
           count(v.tenant_id) filter (where v.eligible and v.stance = 1) as sup,
           count(v.tenant_id) filter (where v.eligible and v.stance = -1) as con,
           count(v.tenant_id) filter (where v.eligible and v.stance = -1 and v.last_at >= p_now - interval '14 days') as con_recent,
           coalesce(sum(v.sessions_n) filter (where v.eligible and v.stance = 1), 0) as sess,
           coalesce(max(w.w), 0) as wk
      from public.portal_rule_proposals p
      left join public.portal_rule_votes v on v.proposal_key = p.proposal_key
      left join weeks w on w.proposal_key = p.proposal_key and w.portal = p.portal
     where p.source = 'corrections' and p.kind in ('label_map', 'option_map') and p.state in ('collecting', 'ready')
     group by p.id
  )
  update public.portal_rule_proposals p
     set support_tenants = s.sup, contradict_tenants = s.con, support_sessions = s.sess, weeks_n = s.wk,
         confidence = public.pt_wilson_lb(s.sup::integer, (s.sup + s.con)::integer),
         state = case when s.sup >= v_min_tenants and public.pt_wilson_lb(s.sup::integer, (s.sup + s.con)::integer) >= 0.5
                           and s.sess >= v_min_sessions and s.wk >= 2 and s.con_recent = 0
                      then 'ready' else 'collecting' end
    from stats s
   where p.id = s.id;

  -- Etiket metni yalniz katalogda acik (k>=2) ise oneriye eklenir (Y2).
  update public.portal_rule_proposals p
     set proposal = p.proposal || jsonb_build_object('label', f.label_folded)
    from public.portal_form_fields f
   where p.kind = 'label_map' and p.source = 'corrections' and p.state in ('collecting', 'ready')
     and f.portal = p.portal and f.field_sig = p.field_sig and f.label_folded is not null and f.distinct_tenants >= 2
     and length(f.label_folded) >= 3 and f.label_folded ~ '[a-z]'
     and not (p.proposal ? 'label');

  -- Kanit gelmeyen eski oneriler suresi doldu sayilir.
  with x as (
    update public.portal_rule_proposals set state = 'expired'
     where state = 'collecting' and source = 'corrections' and last_evaluated < p_now - interval '60 days'
    returning 1
  ) select count(*) into v_expired from x;

  -- 3) Geriletme adaylari: son 14 gunde >=2 uygun ofis, >=5 oturum, hata orani >=%50 (haftalik anahtar).
  with f as (
    select e.portal, e.field_key,
           count(distinct e.tenant_id) filter (where e.outcome in ('corrected', 'cleared')) as bad_tenants,
           count(distinct e.session_id) as sessions,
           count(*) filter (where e.outcome = 'accepted') as ok,
           count(*) filter (where e.outcome in ('corrected', 'cleared')) as bad
      from public.portal_fill_events e
      join public.portal_transfer_sessions s on s.id = e.session_id
      join public.portal_listings pl on pl.id = s.portal_listing_id
     where e.field_key is not null and e.tenant_id = any (v_eligible)
       and s.state = 'published' and s.completed_at >= p_now - interval '14 days' and s.completed_at <= p_now
       and pl.source_kind = 'assisted' and pl.status = 'live'
         and public.pt_rules_worker_seen(pl.id, s.completed_at + interval '1 hour')
     group by e.portal, e.field_key
  )
  insert into public.portal_rule_proposals
    (portal, proposal_key, kind, field_key, proposal, source, support_tenants, support_sessions, weeks_n, confidence, state, first_seen, last_evaluated)
  select f.portal,
         encode(sha256(convert_to('field_demote|' || f.portal || '|' || f.field_key || '|' || to_char(p_now at time zone 'UTC', 'IYYY-IW'), 'UTF8')), 'hex'),
         'field_demote', f.field_key, jsonb_build_object('fail_rate', round(f.bad::numeric / (f.ok + f.bad), 3)), 'corrections',
         f.bad_tenants, f.sessions, 1, round(f.bad::numeric / (f.ok + f.bad), 3), 'ready', p_now, p_now
    from f
   where f.bad_tenants >= 2 and f.sessions >= 5 and f.ok + f.bad > 0 and f.bad::numeric / (f.ok + f.bad) >= 0.5
     and not exists (
       select 1 from public.portal_rule_sets rs, jsonb_array_elements(rs.content -> 'fields') fld
        where rs.portal = f.portal and rs.status = 'published' and fld ->> 'key' = f.field_key
          and fld ->> 'state' in ('degraded', 'disabled'))
  on conflict (portal, proposal_key) do update
    set support_tenants = excluded.support_tenants, support_sessions = excluded.support_sessions,
        confidence = excluded.confidence, last_evaluated = excluded.last_evaluated;

  -- Ayni alan icin onceki haftalarin bekleyen geriletme adayi yenisiyle degistirilir; 14 gun yeniden gorulmeyen
  -- (sorun gecmis) aday suresi doldu sayilir. Boylece personel kuyrugunda haftalik kopya birikmez.
  update public.portal_rule_proposals p set state = 'superseded', decided_at = p_now
   where p.kind = 'field_demote' and p.source = 'corrections' and p.state = 'ready'
     and exists (select 1 from public.portal_rule_proposals n
                  where n.portal = p.portal and n.field_key = p.field_key and n.kind = 'field_demote' and n.source = 'corrections'
                    and n.state = 'ready' and n.id <> p.id and (n.first_seen, n.id) > (p.first_seen, p.id));
  update public.portal_rule_proposals set state = 'expired'
   where kind = 'field_demote' and source = 'corrections' and state = 'ready' and last_evaluated < p_now - interval '14 days';

  select count(*) into v_demotes_week from public.portal_rule_proposals
   where kind = 'field_demote' and state = 'auto_approved' and decided_at >= p_now - interval '7 days';

  -- 4) Alan katalogu: yalniz uygun ofislerin raporlarindan (O3); acik metin yalniz k>=2 (Y2).
  insert into public.portal_form_fields (portal, field_sig, control, label_folded, options_folded, distinct_tenants, first_seen, last_seen, mapped_key)
  select r.portal, r.field_sig, max(r.control),
         case when count(distinct r.tenant_id) >= 2 then mode() within group (order by r.label_folded) end,
         case when count(distinct r.tenant_id) >= 2 then coalesce((select r2.options_folded from public.portal_form_reports r2
                                                       where r2.portal = r.portal and r2.field_sig = r.field_sig and r2.tenant_id = any (v_eligible)
                                                       order by r2.day desc limit 1), '{}'::text[]) else '{}'::text[] end,
         count(distinct r.tenant_id), min(r.day)::timestamptz, max(r.day)::timestamptz,
         mode() within group (order by r.matched_key)
    from public.portal_form_reports r
   where r.tenant_id = any (v_eligible) and r.day >= (p_now - interval '365 days')::date
   group by r.portal, r.field_sig
  on conflict (portal, field_sig) do update
    set control = excluded.control, label_folded = excluded.label_folded, options_folded = excluded.options_folded,
        distinct_tenants = excluded.distinct_tenants, last_seen = excluded.last_seen, mapped_key = excluded.mapped_key;

  -- 5) Form surumleri + "form degisti" uyarisi
  insert into public.portal_form_versions (portal, fingerprint, field_count, tenants_n, first_seen, last_seen)
  select r.portal, r.fingerprint, count(distinct r.field_sig), count(distinct r.tenant_id), min(r.day)::timestamptz, max(r.day)::timestamptz
    from public.portal_form_reports r
   where r.tenant_id = any (v_eligible) and r.day >= (p_now - interval '365 days')::date
   group by r.portal, r.fingerprint
  on conflict (portal, fingerprint) do update
    set field_count = excluded.field_count, tenants_n = excluded.tenants_n, last_seen = excluded.last_seen,
        first_seen = least(public.portal_form_versions.first_seen, excluded.first_seen);

  with dom as (
    select distinct on (v.portal) v.portal, v.fingerprint
      from public.portal_form_versions v
     where v.last_seen >= p_now - interval '14 days'
     order by v.portal, v.tenants_n desc, v.first_seen asc
  ),
  sigs as (
    select distinct r.portal, r.fingerprint, r.field_sig from public.portal_form_reports r where r.tenant_id = any (v_eligible)
  ),
  succ as (
    select e.portal, e.form_fp,
           count(*) filter (where e.outcome = 'accepted')::numeric / nullif(count(*) filter (where e.outcome in ('accepted', 'corrected', 'cleared')), 0) as rate
      from public.portal_fill_events e
     where e.tenant_id = any (v_eligible) and e.created_at >= p_now - interval '14 days' and e.form_fp is not null
     group by e.portal, e.form_fp
  ),
  calc as (
    select v.portal, v.fingerprint, d.fingerprint as dom_fp,
           (select count(*) from sigs a join sigs b on b.portal = a.portal and b.fingerprint = d.fingerprint and b.field_sig = a.field_sig
             where a.portal = v.portal and a.fingerprint = v.fingerprint)::numeric
           / nullif((select count(distinct x.field_sig) from sigs x where x.portal = v.portal and x.fingerprint in (v.fingerprint, d.fingerprint)), 0) as jac,
           coalesce((select rate from succ where succ.portal = v.portal and succ.form_fp = d.fingerprint), 0)
             - coalesce((select rate from succ where succ.portal = v.portal and succ.form_fp = v.fingerprint), 0) as drop
      from public.portal_form_versions v
      left join dom d on d.portal = v.portal
  )
  update public.portal_form_versions v
     set status = case when c.dom_fp = v.fingerprint then 'dominant'
                       when v.last_seen < p_now - interval '30 days' then 'retired'
                       when v.first_seen >= p_now - interval '72 hours' then 'new'
                       else 'known' end,
         jaccard_prev = case when c.dom_fp is null or c.dom_fp = v.fingerprint then null else round(coalesce(c.jac, 0), 3) end,
         alert_state = case when c.dom_fp is null or c.dom_fp = v.fingerprint or v.first_seen < p_now - interval '72 hours' then 'none'
                            when v.tenants_n >= 2 and coalesce(c.jac, 0) < 0.8 and coalesce(c.drop, 0) >= 0.15 then 'warning'
                            when v.tenants_n = 1 then 'info'
                            else 'none' end
    from calc c
   where c.portal = v.portal and c.fingerprint = v.fingerprint;

  select count(*) into v_alerts from public.portal_form_versions where alert_state <> 'none';

  return jsonb_build_object(
    'outcome', 'ok',
    'eligible_tenants', cardinality(v_eligible),
    'votes', v_votes,
    'expired', v_expired,
    'form_alerts', v_alerts,
    'settings', jsonb_build_object('min_tenants', v_min_tenants, 'min_sessions', v_min_sessions,
                                   'auto_publish', v_auto_publish, 'auto_degrade', v_auto_degrade),
    'demote_budget', greatest(3 - v_demotes_week, 0),
    'ready', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'portal', p.portal, 'kind', p.kind, 'field_key', p.field_key,
                                                           'source', p.source, 'proposal', p.proposal, 'confidence', p.confidence)
                                        order by p.portal, p.confidence desc, p.id)
                         from public.portal_rule_proposals p
                        where p.state = 'ready' and p.source = 'corrections' and not p.ai_unverified
                          and p.kind in ('label_map', 'option_map')
                          and not (coalesce(p.field_key, '') = any (public.pt_rules_risky_keys()))), '[]'::jsonb),
    'demote_candidates', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'portal', p.portal, 'kind', p.kind, 'field_key', p.field_key,
                                                                       'source', p.source, 'proposal', p.proposal, 'confidence', p.confidence)
                                                    order by p.portal, p.confidence desc, p.id)
                                     from public.portal_rule_proposals p
                                    where p.state = 'ready' and p.kind = 'field_demote' and p.source = 'corrections'), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Otomatik yayin (cron; imza TS'te)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_rules_publish_system(
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
  v_res jsonb;
begin
  if coalesce(p_kind, '') <> 'auto' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  v_res := public.pt_rules_insert_set(p_portal, p_content, 'auto', p_parent, p_change_summary, p_sha, p_signature, p_kid,
                                      null, null, p_proposal_ids);
  perform public.pt_rules_audit(null, 'portal_rules.publish_auto', 'portal_rule_set', nullif(v_res ->> 'id', '')::uuid,
    jsonb_build_object('system', 'learner', 'portal', p_portal, 'outcome', v_res ->> 'outcome', 'version', v_res -> 'version',
                       'sha', p_sha, 'kid', p_kid, 'refresh', coalesce((p_change_summary ->> 'refresh')::boolean, false)));
  -- Her otomatik icerik degisikligi personele bildirilir (Y4); yalniz sure tazeleme bildirilmez.
  if v_res ->> 'outcome' = 'ok' and not coalesce((p_change_summary ->> 'refresh') = 'true', false) then
    insert into public.platform_notifications (staff_id, title, body, href, kind, meta)
    select ps.id, 'Portal kuralları otomatik güncellendi',
           p_portal || ' için ' || (v_res ->> 'version') || '. sürüm yayınlandı (' || coalesce(p_change_summary ->> 'count', '0') || ' değişiklik).',
           '/admin/sistem?sekme=portal-kurallari', 'warning',
           jsonb_build_object('portal', p_portal, 'rule_set_id', v_res ->> 'id')
      from public.platform_staff ps
     where ps.is_active and ps.role in ('super_admin', 'ops');
  end if;
  return v_res;
end;
$$;

-- Otomatik yayinda uygulanamayan oneri (cron; service_role): 'rejected' + gerekce. AI ve personel onerisine dokunmaz.
create or replace function public.pt_rules_mark_invalid(p_ids uuid[], p_reason text)
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  with x as (
    update public.portal_rule_proposals
       set state = 'rejected', decided_at = now(),
           decision_reason = left('Otomatik yayında uygulanamadı: ' || coalesce(nullif(btrim(p_reason), ''), 'bilinmiyor'), 500)
     where id = any (coalesce(p_ids, '{}'::uuid[])) and state = 'ready' and source = 'corrections'
    returning 1
  ) select count(*)::integer from x;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Saklama
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_learning_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_events integer;
  v_reports integer;
  v_votes integer;
  v_proposals integer;
  v_fields integer;
  v_versions integer;
begin
  with d as (delete from public.portal_fill_events where created_at < p_now - interval '180 days' returning 1) select count(*) into v_events from d;
  with d as (delete from public.portal_form_reports where day < (p_now - interval '90 days')::date returning 1) select count(*) into v_reports from d;
  with d as (delete from public.portal_rule_votes where last_at < p_now - interval '180 days' returning 1) select count(*) into v_votes from d;
  with d as (
    delete from public.portal_rule_proposals
     where state in ('rejected', 'expired', 'superseded') and coalesce(decided_at, last_evaluated) < p_now - interval '1 year'
    returning 1
  ) select count(*) into v_proposals from d;
  with d as (delete from public.portal_form_fields where last_seen < p_now - interval '1 year' returning 1) select count(*) into v_fields from d;
  with d as (delete from public.portal_form_versions where last_seen < p_now - interval '1 year' returning 1) select count(*) into v_versions from d;
  return jsonb_build_object('outcome', 'ok', 'fill_events', v_events, 'form_reports', v_reports, 'votes', v_votes,
                            'proposals', v_proposals, 'form_fields', v_fields, 'form_versions', v_versions);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Yetkiler: YALNIZ service_role
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function public.pt_rules_setting_int(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.pt_rules_setting_bool(text, boolean) from public, anon, authenticated;
revoke all on function public.pt_wilson_lb(integer, integer) from public, anon, authenticated;
revoke all on function public.pt_rules_eligible_tenants(timestamptz) from public, anon, authenticated;
revoke all on function public.pt_rules_learn_evidence(timestamptz, uuid[]) from public, anon, authenticated;
revoke all on function public.pt_rules_learn(timestamptz) from public, anon, authenticated;
revoke all on function public.pt_rules_publish_system(text, jsonb, text, uuid, jsonb, text, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.pt_learning_retention(timestamptz) from public, anon, authenticated;
revoke all on function public.pt_rules_risky_keys() from public, anon, authenticated;
revoke all on function public.pt_rules_mark_invalid(uuid[], text) from public, anon, authenticated;
grant execute on function public.pt_rules_learn(timestamptz) to service_role;
grant execute on function public.pt_rules_publish_system(text, jsonb, text, uuid, jsonb, text, text, text, uuid[]) to service_role;
grant execute on function public.pt_learning_retention(timestamptz) to service_role;
grant execute on function public.pt_rules_mark_invalid(uuid[], text) to service_role;

notify pgrst, 'reload schema';
