-- MIGRATION 20261012001200_price_proposal_oversight_gate.sql (GUVENLIK-1: fiyat onerisi ofis onay kapisini ASAMAZ)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012001200_price_proposal_oversight_gate.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012001200_price_proposal_oversight_gate.rollback.sql
--
-- NEDEN: 20261012000800 (CANLIDA) mulk sahibi onayini "ofis esik-ustu fiyat dusurme onayinin yerine" sayiyordu:
--   danisman portfoy fiyatini dusurmek istediginde yonetici onayi yerine kendi actigi oneriyi mulk sahibine onaylatip
--   (telefonla "olur" dedirtip) ofis kuralini atlayabiliyordu. Kural: mulk sahibi onayi YONETICI onayinin yerine gecmez;
--   ikisi birden gerekir (kural aciksa, esik ustuyse ve oneren owner/gm degilse).
--
-- NE YAPAR (hepsi create or replace / ek; canli veri degismez):
--   1. property_price_proposals.status kisitina 'awaiting_manager' (mulk sahibi onayladi, yonetici onayi bekleniyor) eklenir
--      (drop + add constraint not valid + validate). Tekil "acik oneri" indeksi pending + awaiting_manager'i kapsar.
--   2. price_drop_check(): guard ile AYNI karar mantigi tek yerde (kural acik mi, esik varsayilan 15, sinir 1..90, referans
--      fiyat = mevcut ve son 30 gun tarihcesinin tepesi). Guard ve token RPC'si bunu kullanir (kopya kural kaymasi olmaz).
--   3. decide_property_price_proposal_by_token 'approved' dali: kural acik + dusus >= esik + oneren (proposed_by) owner/gm DEGIL
--      ise fiyat UYGULANMAZ; oneri 'awaiting_manager' olur (owner_note + decided_at yazilir), uygulamadaki
--      requestApprovalIfNeeded ile BIREBIR ayni bicimde bekleyen bir approval_requests satiri acilir
--      (kind fiyat_degisikligi, description '[oversight:price_drop:<ilan_id>] ...', requested_value = onerilen fiyat,
--      requested_by = proposed_by, entity property). Ayni ilan + ayni talep sahibi icin bekleyen talep varsa yenisi acilmaz.
--      Ofis owner/gm kullanicilarina ve danisman/onerene bildirim. Donus: outcome 'awaiting_manager' | 'applied'.
--      Kural kapaliysa veya esik altindaysa akis bugunku gibi: fiyat ayni islemde uygulanir (+ changed_by = oneren).
--   4. guard_property_list_price_drop(): 20261012000800'daki "approved + decided_at = now()" erken donusu KALDIRILDI.
--      Muafiyetler YALNIZ esik hesabindan SONRA:
--        (c) AYNI islemde tuketilmis (consumed_at = now()) eslesen '[oversight:price_drop:<ilan>]' onayi (yeni fiyat >= onaylanan
--            fiyat) VE o onayin talep sahibi = ayni islemde onaylanmis (decided_at = now()) onerinin sahibi ve hedef fiyati
--            tam bu fiyat. Bu yol yalniz apply_price_proposal_after_approval RPC'sinden gecer (onayi yonetici verdigi icin
--            talep sahibi != cagiran; mevcut (b) yolu "talep sahibi = cagiran" istedigi icin burada gecerli degildir).
--        (d) oneren owner/gm ise (uygulama muafiyetiyle ayni DAR kume) ayni islemde onaylanmis oneri gecer.
--      Esik altindaki dususler zaten dogal olarak gecer. (a)/(b) yollari degismedi.
--   5. apply_price_proposal_after_approval(p_proposal_id) (authenticated, SECURITY DEFINER, search_path=''): oneri
--      'awaiting_manager', cagiran ayni ofiste ve (oneren veya onay kademesi), eslesen approval_request 'onaylandi',
--      48 saat icinde ve tuketilmemis ise TEK islemde: onayi FOR UPDATE ile tuketir, oneriyi 'approved' yapar, list_price'i
--      gunceller, fiyat izine changed_by = oneren ve 'Mülk sahibi + yönetici onaylı fiyat revizyonu · öneren: <ad>' yazar.
--      Fiyat bu arada degistiyse oneri 'expired' olur (price_changed).
--   6. reject_price_proposal_after_denial(p_proposal_id): yonetici onay talebini REDDETTIYSE oneri 'rejected' olur.
--   7. create_/cancel_property_price_proposal: 'awaiting_manager' acik oneri sayilir (ikinci oneri acilmaz, iptal edilebilir);
--      14 gunden eski awaiting_manager otomatik 'expired' olur.
-- BAGIMLILIK: 20261012000800 (tablo + RPC'ler), 20261007000800 (guard), 20260823000100 (approval_requests.consumed_at +
--   approval_actor_can_decide + guard_approval_request_update), 20260820000100 (oversight_settings), profiles, notifications.
-- ETKI: davranis (kural ACIK ofiste esik-ustu fiyat onerisi artik yonetici onayi ister). Kural kapaliyken ve esik altinda
--   davranis ayni. Anon'a yeni RPC acilmaz; authenticated'a 2 yeni RPC (tenant + onay sarti icerde).
-- RISK: dusuk-orta. Mevcut 'approved' oneri satirlari etkilenmez. Kural ACIK ofiste bekleyen (pending) oneri, mulk sahibi
--   onayladiginda yonetici onayina duser (istenen davranis).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.property_price_proposals') is null
     or pg_catalog.to_regclass('public.property_price_history') is null
     or pg_catalog.to_regclass('public.approval_requests') is null
     or pg_catalog.to_regclass('public.oversight_settings') is null
     or pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regprocedure('public.guard_property_list_price_drop()') is null
     or pg_catalog.to_regprocedure('public.decide_property_price_proposal_by_token(text,uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.create_property_price_proposal(uuid,numeric,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.cancel_property_price_proposal(uuid)') is null
     or pg_catalog.to_regprocedure('public.approval_actor_can_decide()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception '20261012001200: fiyat onerisi/onay tablolari veya RPC''leri yok; once 20261012000800, 20261007000800 ve 20260823000100 uygulanmali.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'approval_requests' and column_name = 'consumed_at'
  ) then
    raise exception '20261012001200: approval_requests.consumed_at yok; once 20260823000100 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Durum kisiti + tekil acik oneri indeksi
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.property_price_proposals'::regclass
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute pg_catalog.format('alter table public.property_price_proposals drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.property_price_proposals
  add constraint property_price_proposals_status_check
  check (status in ('pending', 'awaiting_manager', 'approved', 'rejected', 'expired')) not valid;
alter table public.property_price_proposals validate constraint property_price_proposals_status_check;

drop index if exists public.uq_property_price_proposals_pending;
create unique index if not exists uq_property_price_proposals_open
  on public.property_price_proposals (property_id) where status in ('pending', 'awaiting_manager');

comment on column public.property_price_proposals.status is
  'pending (mulk sahibi bekleniyor) | awaiting_manager (mulk sahibi onayladi, ofis kurali geregi yonetici onayi bekleniyor) | approved | rejected | expired.';

-- ---------------------------------------------------------------------------
-- 2) Ortak karar: bu dusus ofis kuralina gore yonetici onayi gerektirir mi? (guard ile ayni mantik)
-- ---------------------------------------------------------------------------
create or replace function public.price_drop_check(p_tenant uuid, p_property uuid, p_current numeric, p_new numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule jsonb;
  v_raw text;
  v_threshold numeric := 15;
  v_drop_pct numeric;
  v_ref numeric;
begin
  -- Referans fiyat: mevcut deger ile son 30 gunluk tarihcedeki en yuksek liste fiyati.
  select max(x.p) into v_ref
    from (
      select p_current as p
      union all
      select greatest(h.old_price, h.new_price)
        from public.property_price_history h
       where h.property_id = p_property
         and h.price_field = 'list_price'
         and h.created_at > now() - interval '30 days'
    ) x;
  if v_ref is null or v_ref <= 0 then
    return jsonb_build_object('required', false);
  end if;
  if p_new is not null and p_new >= v_ref then
    return jsonb_build_object('required', false);
  end if;

  select s.approval_rules -> 'price_drop' into v_rule
    from public.oversight_settings s
   where s.tenant_id = p_tenant;

  -- Kural yok/kapali: uygulama katmaniyla ayni (varsayilan KAPALI).
  if v_rule is null
     or jsonb_typeof(v_rule) <> 'object'
     or jsonb_typeof(v_rule -> 'enabled') is distinct from 'boolean'
     or (v_rule ->> 'enabled') <> 'true' then
    return jsonb_build_object('required', false);
  end if;

  -- Esik: sayi ya da sayi metni (virgul/nokta); bozuksa varsayilan 15; 1..90 araligina sikistirilir.
  v_raw := case jsonb_typeof(v_rule -> 'threshold')
             when 'number' then v_rule ->> 'threshold'
             when 'string' then replace(btrim(v_rule ->> 'threshold'), ',', '.')
             else null
           end;
  if v_raw is not null and v_raw ~ '^[0-9]+([.][0-9]+)?$' then
    v_threshold := least(90, greatest(1, v_raw::numeric));
  end if;

  v_drop_pct := (v_ref - coalesce(p_new, 0)) / v_ref * 100;
  return jsonb_build_object('required', v_drop_pct >= v_threshold, 'drop_pct', v_drop_pct, 'threshold', v_threshold);
end;
$$;

comment on function public.price_drop_check(uuid, uuid, numeric, numeric) is
  'Ofis price_drop kuralina gore bu dusus yonetici onayi gerektirir mi (guard_property_list_price_drop ve mulk sahibi onay RPC''si ortak). Istemciye ACIK DEGIL.';
revoke all on function public.price_drop_check(uuid, uuid, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Danisman: oneri olustur / iptal (awaiting_manager acik oneri sayilir)
-- ---------------------------------------------------------------------------
create or replace function public.create_property_price_proposal(
  p_property_id uuid,
  p_new_price numeric,
  p_reason text,
  p_comparables jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_prop record;
  v_reason text := left(btrim(coalesce(p_reason, '')), 1000);
  v_new numeric;
  v_id uuid;
begin
  if v_uid is null or v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not public.has_effective_permission('properties', 'edit') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_new_price is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_price');
  end if;
  v_new := round(p_new_price, 2);
  if v_new <= 0 or v_new > 1000000000000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_price');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'invalid_reason');
  end if;
  if p_comparables is not null and (jsonb_typeof(p_comparables) <> 'object' or octet_length(p_comparables::text) > 16000) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select pr.id, pr.list_price, pr.assigned_to into v_prop
    from public.properties pr
   where pr.id = p_property_id and pr.tenant_id = v_tenant and pr.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_prop.list_price is null or v_prop.list_price <= 0 then
    return jsonb_build_object('ok', false, 'code', 'no_current_price');
  end if;
  if v_new = round(v_prop.list_price, 2) then
    return jsonb_build_object('ok', false, 'code', 'same_price');
  end if;

  -- Mulk sahibi bu oneriyi ancak aktif bir malik portali baglantisiyla gorebilir.
  if not exists (
    select 1 from public.owner_portal_tokens t
     where t.property_id = p_property_id and t.tenant_id = v_tenant and t.expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'no_owner_portal');
  end if;

  update public.property_price_proposals
     set status = 'expired', decided_at = now()
   where property_id = p_property_id
     and ((status = 'pending' and expires_at <= now())
       or (status = 'awaiting_manager' and decided_at <= now() - interval '14 days'));
  if exists (
    select 1 from public.property_price_proposals x
     where x.property_id = p_property_id and x.status in ('pending', 'awaiting_manager')
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_pending');
  end if;

  insert into public.property_price_proposals (tenant_id, property_id, proposed_by, old_price, new_price, reason, comparables_snapshot)
  values (v_tenant, p_property_id, v_uid, round(v_prop.list_price, 2), v_new, v_reason, p_comparables)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'id', v_id);
end;
$$;

create or replace function public.cancel_property_price_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_rows integer;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('properties', 'edit') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  update public.property_price_proposals
     set status = 'expired', decided_at = now()
   where id = p_proposal_id and tenant_id = v_tenant and status in ('pending', 'awaiting_manager');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.create_property_price_proposal(uuid, numeric, text, jsonb) from public, anon;
grant execute on function public.create_property_price_proposal(uuid, numeric, text, jsonb) to authenticated, service_role;
revoke all on function public.cancel_property_price_proposal(uuid) from public, anon;
grant execute on function public.cancel_property_price_proposal(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Mulk sahibi: token ile karar (onay dalinda ofis onay kapisi)
-- ---------------------------------------------------------------------------
create or replace function public.decide_property_price_proposal_by_token(
  p_token text,
  p_proposal_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_property uuid;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_prop record;
  v_prop_row record;
  v_user uuid;
  v_other uuid;
  v_title text;
  v_body text;
  v_label text;
  v_money_old text;
  v_money_new text;
  v_check jsonb;
  v_proposer_role text;
  v_proposer_name text;
  v_outcome text := null;
  v_desc text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  if v_decision not in ('approved', 'rejected', 'note') or p_proposal_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if v_decision = 'note' and v_note is null then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;

  select opt.tenant_id, opt.property_id into v_tenant, v_property
    from public.owner_portal_tokens opt
    join public.tenants tn on tn.id = opt.tenant_id
   where opt.token = p_token and opt.expires_at > now() and tn.status in ('active', 'trial', 'past_due');
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;

  -- KVKK: oneri yalniz token'in kendi portfoyune aitse gorulur.
  select pp.* into v_prop
    from public.property_price_proposals pp
   where pp.id = p_proposal_id and pp.tenant_id = v_tenant and pp.property_id = v_property
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_prop.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', case when v_prop.status = 'expired' then 'expired' else 'already_decided' end);
  end if;
  if v_prop.expires_at <= now() then
    update public.property_price_proposals set status = 'expired', decided_at = now() where id = v_prop.id;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  select pr.id, pr.list_price, pr.assigned_to, pr.property_code, pr.title into v_prop_row
    from public.properties pr
   where pr.id = v_property and pr.tenant_id = v_tenant and pr.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_label := coalesce(nullif(v_prop_row.property_code, ''), nullif(v_prop_row.title, ''), 'Portföy');
  v_money_old := to_char(v_prop.old_price, 'FM999G999G999G990');
  v_money_new := to_char(v_prop.new_price, 'FM999G999G999G990');

  select p.role, p.full_name into v_proposer_role, v_proposer_name
    from public.profiles p
   where p.id = v_prop.proposed_by and p.tenant_id = v_tenant;

  -- Alici: portfoyun danismani (aktif degilse oneriyi hazirlayan); farkliysa ikisi de bilgilenir.
  select p.id into v_user from public.profiles p
   where p.tenant_id = v_tenant and p.is_active = true and p.id in (v_prop_row.assigned_to, v_prop.proposed_by)
   order by case when p.id = v_prop_row.assigned_to then 0 else 1 end limit 1;
  select p.id into v_other from public.profiles p
   where p.tenant_id = v_tenant and p.is_active = true and p.id in (v_prop_row.assigned_to, v_prop.proposed_by)
     and p.id is distinct from v_user limit 1;

  if v_decision = 'approved' then
    -- Danisman oneriyi hazirladiktan sonra fiyat degistiyse onay eski fiyata dayanir: bayat sayilir.
    if v_prop_row.list_price is null or round(v_prop_row.list_price, 2) <> v_prop.old_price then
      update public.property_price_proposals set status = 'expired', decided_at = now() where id = v_prop.id;
      return jsonb_build_object('ok', false, 'code', 'price_changed');
    end if;

    v_check := public.price_drop_check(v_tenant, v_property, v_prop_row.list_price, v_prop.new_price);

    if coalesce((v_check ->> 'required')::boolean, false) and coalesce(v_proposer_role, '') not in ('owner', 'gm') then
      -- Ofis kurali: esik-ustu dusus yonetici onayi ister. Mulk sahibi onayi YONETICI onayinin yerine gecmez; fiyat UYGULANMAZ.
      update public.property_price_proposals
         set status = 'awaiting_manager', decided_at = now(), owner_note = v_note
       where id = v_prop.id;

      if not exists (
        select 1 from public.approval_requests a
         where a.tenant_id = v_tenant
           and a.status = 'bekliyor'
           and a.requested_by is not distinct from v_prop.proposed_by
           and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || v_property::text || ']')
      ) then
        v_desc := '[oversight:price_drop:' || v_property::text || '] Fiyat %'
          || replace(round((v_check ->> 'drop_pct')::numeric, 1)::text, '.', ',')
          || ' düşüyor (eşik %' || replace(round((v_check ->> 'threshold')::numeric, 1)::text, '.', ',') || ').'
          || ' Mülk sahibi onayladı; öneren: ' || coalesce(nullif(v_proposer_name, ''), 'danışman') || '.';
        insert into public.approval_requests
          (tenant_id, kind, title, description, amount, current_value, requested_value, entity_type, entity_id, status, requested_by)
        values
          (v_tenant, 'fiyat_degisikligi', left('Eşik üstü fiyat düşürme: ' || v_label, 200), v_desc,
           v_prop.new_price, v_prop.old_price, v_prop.new_price, 'property', v_property, 'bekliyor', v_prop.proposed_by);
      end if;

      v_outcome := 'awaiting_manager';
      v_title := 'Mülk sahibi onayladı; yönetici onayı bekleniyor';
      v_body := left(v_label || ' · ' || v_money_old || ' TL → ' || v_money_new || ' TL. Ofis kuralı gereği fiyat, yönetici onayından sonra güncellenecek.'
        || coalesce(' Not: ' || v_note, ''), 900);

      -- Karar vericiler: ofis sahibi / genel mudur (zaten alici olanlar tekrar bildirilmez).
      insert into public.notifications (tenant_id, user_id, title, body, href, kind, meta)
      select v_tenant, m.id, 'Onay bekliyor: fiyat düşürme', v_body, '/app/onaylar?durum=bekliyor', 'warning',
             jsonb_build_object('source', 'price_proposal', 'proposal_id', v_prop.id, 'decision', 'awaiting_manager')
        from public.profiles m
       where m.tenant_id = v_tenant and m.is_active = true and m.role in ('owner', 'gm')
         and m.id is distinct from v_user and m.id is distinct from v_other;
    else
      -- Kural kapali / esik alti / oneren owner-gm: bugunku akis. Fiyat kapisi (guard) 'approved + decided_at = now()' ve
      -- oneren owner/gm ise (d) yolunu gorur; esik altinda zaten gecer.
      update public.property_price_proposals
         set status = 'approved', decided_at = now(), owner_note = v_note
       where id = v_prop.id;
      update public.properties set list_price = v_prop.new_price where id = v_property and tenant_id = v_tenant;
      -- Fiyat izi: degisikligi yapan = oneren danisman (token oturumsuz oldugundan tetikleyici changed_by'i bos birakir).
      update public.property_price_history
         set reason = 'Mülk sahibi onaylı fiyat revizyonu · öneren: ' || coalesce(nullif(v_proposer_name, ''), 'bilinmiyor'),
             changed_by = v_prop.proposed_by
       where id = (
         select h.id from public.property_price_history h
          where h.property_id = v_property and h.price_field = 'list_price' and h.created_at = now() and h.new_price = v_prop.new_price
          order by h.id limit 1
       );
      v_outcome := 'applied';
      v_title := 'Mülk sahibi fiyat önerisini onayladı';
      v_body := left(v_label || ' · ' || v_money_old || ' TL → ' || v_money_new || ' TL. Portföy fiyatı güncellendi.'
        || coalesce(' Not: ' || v_note, ''), 900);
    end if;
  elsif v_decision = 'rejected' then
    update public.property_price_proposals
       set status = 'rejected', decided_at = now(), owner_note = v_note
     where id = v_prop.id;
    v_title := 'Mülk sahibi fiyat önerisini reddetti';
    v_body := left(v_label || ' · önerilen ' || v_money_new || ' TL kabul edilmedi (mevcut ' || v_money_old || ' TL).'
      || coalesce(' Not: ' || v_note, ''), 900);
  else
    update public.property_price_proposals set owner_note = v_note where id = v_prop.id;
    v_title := 'Mülk sahibi fiyat önerisine not ekledi';
    v_body := left(v_label || ' · önerilen ' || v_money_new || ' TL · Not: ' || v_note, 900);
  end if;

  insert into public.notifications (tenant_id, user_id, title, body, href, kind, meta)
  select v_tenant, x.u, v_title, v_body, '/app/portfoyler/' || v_property::text,
         case when v_outcome = 'awaiting_manager' then 'info'
              when v_decision = 'approved' then 'success'
              when v_decision = 'rejected' then 'warning'
              else 'info' end,
         jsonb_build_object('source', 'price_proposal', 'proposal_id', v_prop.id, 'decision', v_decision)
    from (values (v_user), (v_other)) x(u)
   where x.u is not null;

  if v_decision in ('rejected', 'note') and v_user is not null then
    insert into public.tasks (tenant_id, title, notes, kind, priority, status, due_at, assigned_to, property_id)
    values (v_tenant,
            case when v_decision = 'rejected' then 'Mülk sahibiyle fiyatı görüş' else 'Mülk sahibinin fiyat notunu yanıtla' end,
            v_body, 'call', 'high', 'open', now() + interval '1 day', v_user, v_property);
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'decision', v_decision)
    || case when v_outcome is null then '{}'::jsonb else jsonb_build_object('outcome', v_outcome) end;
end;
$$;

revoke all on function public.decide_property_price_proposal_by_token(text, uuid, text, text) from public;
grant execute on function public.decide_property_price_proposal_by_token(text, uuid, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Yonetici onayindan sonra fiyati uygula (tek islem)
-- ---------------------------------------------------------------------------
create or replace function public.apply_price_proposal_after_approval(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_prop record;
  v_prop_row record;
  v_approval uuid;
  v_rows integer;
  v_name text;
  v_label text;
begin
  if v_uid is null or v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select pp.* into v_prop
    from public.property_price_proposals pp
   where pp.id = p_proposal_id and pp.tenant_id = v_tenant
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_prop.status <> 'awaiting_manager' then
    return jsonb_build_object('ok', false, 'code', 'not_awaiting');
  end if;
  -- Cagiran: oneriyi acan danisman ya da onay kademesi (karari veren yonetici).
  if v_prop.proposed_by is distinct from v_uid and not public.approval_actor_can_decide() then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select pr.id, pr.list_price, pr.assigned_to, pr.property_code, pr.title into v_prop_row
    from public.properties pr
   where pr.id = v_prop.property_id and pr.tenant_id = v_tenant and pr.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_prop_row.list_price is null or round(v_prop_row.list_price, 2) <> v_prop.old_price then
    update public.property_price_proposals set status = 'expired', decided_at = now() where id = v_prop.id;
    return jsonb_build_object('ok', false, 'code', 'price_changed');
  end if;

  -- Eslesen yonetici onayi: ayni talep sahibi (oneren), ayni ilan parmak izi, 48 saat, tuketilmemis, onaylanan fiyat <= onerilen.
  select a.id into v_approval
    from public.approval_requests a
   where a.tenant_id = v_tenant
     and a.requested_by is not distinct from v_prop.proposed_by
     and a.status = 'onaylandi'
     and a.consumed_at is null
     and a.decided_at is not null
     and a.decided_at > now() - interval '48 hours'
     and a.requested_value is not null
     and v_prop.new_price >= a.requested_value
     and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || v_prop.property_id::text || ']')
   order by a.decided_at desc
   limit 1
   for update;
  if v_approval is null then
    return jsonb_build_object('ok', false, 'code', 'no_approval');
  end if;

  update public.approval_requests set consumed_at = now() where id = v_approval and consumed_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return jsonb_build_object('ok', false, 'code', 'no_approval');
  end if;

  update public.property_price_proposals set status = 'approved', decided_at = now() where id = v_prop.id;
  -- guard_property_list_price_drop: ayni islemde tuketilmis eslesen onay + ayni islemde onaylanmis oneri (yol c).
  update public.properties set list_price = v_prop.new_price where id = v_prop.property_id and tenant_id = v_tenant;

  select p.full_name into v_name from public.profiles p where p.id = v_prop.proposed_by and p.tenant_id = v_tenant;
  update public.property_price_history
     set reason = 'Mülk sahibi + yönetici onaylı fiyat revizyonu · öneren: ' || coalesce(nullif(v_name, ''), 'bilinmiyor'),
         changed_by = v_prop.proposed_by
   where id = (
     select h.id from public.property_price_history h
      where h.property_id = v_prop.property_id and h.price_field = 'list_price' and h.created_at = now() and h.new_price = v_prop.new_price
      order by h.id limit 1
   );

  v_label := coalesce(nullif(v_prop_row.property_code, ''), nullif(v_prop_row.title, ''), 'Portföy');
  insert into public.notifications (tenant_id, user_id, title, body, href, kind, meta)
  select v_tenant, x.u, 'Fiyat yönetici onayıyla güncellendi',
         left(v_label || ' · ' || to_char(v_prop.old_price, 'FM999G999G999G990') || ' TL → '
              || to_char(v_prop.new_price, 'FM999G999G999G990') || ' TL. Mülk sahibi ve yönetici onayladı.', 900),
         '/app/portfoyler/' || v_prop.property_id::text, 'success',
         jsonb_build_object('source', 'price_proposal', 'proposal_id', v_prop.id, 'decision', 'applied')
    from (
      select p.id as u from public.profiles p
       where p.tenant_id = v_tenant and p.is_active = true and p.id in (v_prop_row.assigned_to, v_prop.proposed_by)
    ) x;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Yonetici onay talebini reddettiyse oneri 'rejected' olur
-- ---------------------------------------------------------------------------
create or replace function public.reject_price_proposal_after_denial(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_prop record;
begin
  if v_uid is null or v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select pp.* into v_prop
    from public.property_price_proposals pp
   where pp.id = p_proposal_id and pp.tenant_id = v_tenant
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_prop.status <> 'awaiting_manager' then
    return jsonb_build_object('ok', false, 'code', 'not_awaiting');
  end if;
  if v_prop.proposed_by is distinct from v_uid and not public.approval_actor_can_decide() then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  -- Yalniz GERCEKTEN reddedilmis eslesen talep varsa (mulk sahibi onayindan sonra karar verilmis).
  if not exists (
    select 1 from public.approval_requests a
     where a.tenant_id = v_tenant
       and a.requested_by is not distinct from v_prop.proposed_by
       and a.status = 'reddedildi'
       and a.decided_at is not null
       and a.decided_at >= v_prop.decided_at
       and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || v_prop.property_id::text || ']')
  ) then
    return jsonb_build_object('ok', false, 'code', 'no_denial');
  end if;

  update public.property_price_proposals set status = 'rejected', decided_at = now() where id = v_prop.id;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.apply_price_proposal_after_approval(uuid) from public, anon;
grant execute on function public.apply_price_proposal_after_approval(uuid) to authenticated, service_role;
revoke all on function public.reject_price_proposal_after_denial(uuid) from public, anon;
grant execute on function public.reject_price_proposal_after_denial(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Fiyat dusurme kapisi: mulk sahibi onayi yonetici onayinin YERINE GECMEZ
--    (govde 20261007000800 ile ayni; 20261012000800'daki erken donus kalkti, kural kontrolu price_drop_check'e tasindi,
--     yeni muafiyetler esik hesabindan SONRA: (c) ayni islemde tuketilmis onay, (d) oneren owner/gm)
-- ---------------------------------------------------------------------------
create or replace function public.guard_property_list_price_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_approval uuid;
  v_rows integer;
begin
  -- service_role (cron/seed/admin), migration ve dogrudan DB oturumlari bu kurala tabi degil.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;

  -- Degismeyen deger ve ARTIS gecer. Fiyatin BOSALTILMASI (NULL) dusus sayilir (NULL ara adimiyla atlama kapanir).
  if new.list_price is not distinct from old.list_price then
    return new;
  end if;
  if new.list_price is not null and old.list_price is not null and new.list_price >= old.list_price then
    return new;
  end if;

  -- Referans fiyat + kural + esik (kural kapali / esik alti / referansin ustu = gecir): tek yerde.
  if not coalesce((public.price_drop_check(old.tenant_id, old.id, old.list_price, new.list_price) ->> 'required')::boolean, false) then
    return new;
  end if;

  -- Muafiyet: yalniz owner/gm (src/lib/team/assignable-roles.ts APPROVAL_EXEMPT_ROLES).
  if public.current_profile_role() in ('owner', 'gm') then
    return new;
  end if;

  -- (c) Yonetici onayi AYNI islemde tuketildi (apply_price_proposal_after_approval): onay talep sahibi, ayni islemde
  --     onaylanmis ve tam bu fiyati hedefleyen onerinin sahibi olmali. Mulk sahibi onayi TEK BASINA yetmez.
  if new.list_price is not null and exists (
    select 1
      from public.approval_requests a
      join public.property_price_proposals pp
        on pp.property_id = old.id and pp.tenant_id = old.tenant_id
       and pp.proposed_by is not distinct from a.requested_by
     where a.tenant_id = old.tenant_id
       and a.status = 'onaylandi'
       and a.consumed_at = now()
       and a.decided_at is not null
       and a.decided_at > now() - interval '48 hours'
       and a.requested_value is not null
       and new.list_price >= a.requested_value
       and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
       and pp.status = 'approved'
       and pp.decided_at = now()
       and pp.new_price = new.list_price
  ) then
    return new;
  end if;

  -- (d) Oneren owner/gm ise (uygulamadaki DAR muafiyetle ayni kume) ayni islemde onaylanmis oneri gecer.
  if new.list_price is not null and exists (
    select 1
      from public.property_price_proposals pp
      join public.profiles pr on pr.id = pp.proposed_by and pr.tenant_id = pp.tenant_id
     where pp.property_id = old.id and pp.tenant_id = old.tenant_id
       and pp.status = 'approved' and pp.decided_at = now() and pp.new_price = new.list_price
       and pr.role in ('owner', 'gm')
  ) then
    return new;
  end if;

  if v_uid is null then
    raise exception 'Fiyat dusurmesi icin oturum gerekli.' using errcode = '42501';
  end if;

  -- (a) Tuketilmemis onayli talebi atomik tuket.
  select a.id into v_approval
    from public.approval_requests a
   where a.tenant_id = old.tenant_id
     and a.requested_by = v_uid
     and a.status = 'onaylandi'
     and a.consumed_at is null
     and a.decided_at is not null
     and a.decided_at > now() - interval '48 hours'
     and a.requested_value is not null
     and new.list_price >= a.requested_value
     and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
   order by a.decided_at desc
   limit 1
   for update;

  if v_approval is not null then
    update public.approval_requests
       set consumed_at = now()
     where id = v_approval and consumed_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      return new;
    end if;
  end if;

  -- (b) Uygulama yolu onayi bu UPDATE'ten hemen once tuketmistir (consume -> update).
  if exists (
    select 1
      from public.approval_requests a
     where a.tenant_id = old.tenant_id
       and a.requested_by = v_uid
       and a.status = 'onaylandi'
       and a.consumed_at is not null
       and a.consumed_at > now() - interval '5 minutes'
       and a.decided_at is not null
       and a.decided_at > now() - interval '48 hours'
       and a.requested_value is not null
       and new.list_price >= a.requested_value
       and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
  ) then
    return new;
  end if;

  raise exception 'Bu fiyat dusurmesi ofis kurali geregi yonetici onayi gerektirir (/app/onaylar).' using errcode = '42501';
end;
$$;

comment on function public.guard_property_list_price_drop() is
  'properties BEFORE UPDATE OF list_price: kural acik + esik ustu dusus + owner/gm degil => eslesen yonetici onayini tuketir (veya ayni islemde tuketilmis onay + onayli oneri), yoksa 42501. Mulk sahibi onayi tek basina yetmez. Yalniz authenticated.';

revoke all on function public.guard_property_list_price_drop() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'property_price_proposals_status_check';  -- awaiting_manager icerir
-- select proname from pg_proc where proname in ('price_drop_check','apply_price_proposal_after_approval','reject_price_proposal_after_denial');  -- BEKLENEN: 3 satir
-- select indexname from pg_indexes where indexname = 'uq_property_price_proposals_open';
