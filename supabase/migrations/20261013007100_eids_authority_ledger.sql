-- EP2: EİDS yetki defteri (silinmeyen olay kaydı) + genişletilmiş portföy yetki durumu + aday eşleştirme.
--
-- NE:
--   (1) properties.authority_eids_status CHECK genişler: unknown | pending | approved | expired | revoked | rejected.
--       "expiring" SAKLANMAZ (authorization_end'den hesaplanır). Varsayılan 'pending' -> 'unknown' (yeni portföy için
--       "henüz bilinmiyor" dürüst değerdir); MEVCUT SATIRLAR DEĞİŞMEZ.
--   (2) properties'e 5 nullable sütun: authority_eids_source (email_verified | email_unverified | manual | document |
--       portal_check), authority_eids_verified_at, authority_grantor_masked (ör. 'Ah*** Yı****'),
--       eids_exempt_reason (no_deed | foreign_owner; işaretli portföy EİDS kontrolünden çıkar), authority_last_email_at.
--   (3) public.eids_authority_events: YALNIZ EKLENİR (UPDATE/DELETE/TRUNCATE tetikle yasak; tek istisna FK eylemleri:
--       portföy silinince property_id boşalır, ofis silinince satırlar gider). Her durum değişikliği, geri alma
--       ("undo", kendisi de olay) ve ofis sahibinin gerekçeli yayın izni ("override") bir satırdır. prev_state
--       değişiklik öncesi, next_state değişiklik sonrası anlık görüntüdür; geri alma YALNIZ olayın değiştirdiği alanları
--       prev_state'e döndürür ve o alanlar olaydan sonra defter dışından (portföy formu) değiştirilmişse reddeder.
--   (4) eids_apply_authority_event / eids_undo_authority_event: SECURITY DEFINER + AÇIK DENETİM (tablo INSERT yetkisi
--       hiçbir role verilmez; olay yalnız bu iki RPC'den yazılır, sahte override/undo satırı eklenemez). Oturumlu çağrıda
--       kiracı = current_tenant_id(), aktör = auth.uid(), portals:edit zorunlu; portföyü değiştiren olayda ayrıca
--       properties:edit (properties RLS UPDATE politikasının birebir karşılığı); override yalnız owner. service_role
--       (EP3 e-posta alıcısı / EP4 cron) kiracıyı parametreyle verir. Portföy satırı kilitlenir, güncelleme + olay aynı
--       işlemde yazılır. Elle veriliş tarihi (valid_from) authorization_start'a yazılır.
--   (5) eids_authority_candidates: pg_trgm kuruluysa malik adı benzerliğiyle en çok 100 aday portföy (ön süzgeç;
--       puan uygulamada hesaplanır). customers.full_name trigram indeksi yoksa kurulur (canlıda zaten var).
--   (6) eids_properties_by_no_key: taşınmaz no'nun YALNIZ RAKAM anahtarıyla birebir arama (ayraçlı kayıt "34-4410-0141"
--       de bulunur); (tenant_id, rakam anahtarı) ifade indeksiyle. SECURITY INVOKER (RLS geçerli).
-- ERİŞİM: olay tablosu RLS: okuma portals:view (ofis sınırı). INSERT/UPDATE/DELETE yetkisi verilmez (yazma RPC'den).
--       Kod sütun/tablo/RPC yokken eski yola düşer (durum doğrudan yazılır, geçmiş "kurulum bekliyor").
-- GERİ ALMA: rollbacks/20261013007100_eids_authority_ledger.rollback.sql (olay geçmişi ve yeni sütunlar SİLİNİR).
-- RİSK: düşük. Yeni nullable sütunlar + genişleyen CHECK (mevcut 3 değer geçerli kalır) + yeni tablo/fonksiyonlar.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null or pg_catalog.to_regclass('public.customers') is null then
    raise exception 'properties/customers yok; once temel migrationlar uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.properties'::regclass and attname = 'authority_eids_status' and not attisdropped
  ) then
    raise exception 'authority_eids_status yok; once 20261008001300_property_authority_status uygulanmali.';
  end if;
end $$;

-- (1) + (2) portföy sütunları ---------------------------------------------------------------------------------------
alter table public.properties
  add column if not exists authority_eids_source text,
  add column if not exists authority_eids_verified_at timestamptz,
  add column if not exists authority_grantor_masked text,
  add column if not exists eids_exempt_reason text,
  add column if not exists authority_last_email_at timestamptz;

alter table public.properties drop constraint if exists properties_authority_eids_status_check;
alter table public.properties
  add constraint properties_authority_eids_status_check
  check (authority_eids_status in ('unknown', 'pending', 'approved', 'expired', 'revoked', 'rejected'));
alter table public.properties alter column authority_eids_status set default 'unknown';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_authority_eids_source_check') then
    alter table public.properties
      add constraint properties_authority_eids_source_check
      check (authority_eids_source is null or authority_eids_source in ('email_verified', 'email_unverified', 'manual', 'document', 'portal_check'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_eids_exempt_reason_check') then
    alter table public.properties
      add constraint properties_eids_exempt_reason_check
      check (eids_exempt_reason is null or eids_exempt_reason in ('no_deed', 'foreign_owner'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_authority_grantor_masked_len_check') then
    alter table public.properties
      add constraint properties_authority_grantor_masked_len_check
      check (authority_grantor_masked is null or char_length(authority_grantor_masked) between 1 and 80);
  end if;
end $$;

comment on column public.properties.authority_eids_status is
  'EİDS yetki durumu: unknown | pending | approved | expired | revoked | rejected. "Bitiyor" authorization_end''den hesaplanır. Tek yazma noktası eids_apply_authority_event.';
comment on column public.properties.authority_eids_source is 'Son durum değişikliğinin kaynağı: email_verified | email_unverified | manual | document | portal_check.';
comment on column public.properties.authority_eids_verified_at is 'Yetkinin son teyit anı (doğrulanmış e-posta, e-Devlet ekran görüntüsü ya da portal kontrolü).';
comment on column public.properties.authority_grantor_masked is 'Yetkiyi veren malik adı, maskeli (ör. Ah*** Yı****). Açık ad saklanmaz.';
comment on column public.properties.eids_exempt_reason is 'EİDS istisnası: no_deed (tapu yok) | foreign_owner (e-Devlet erişimi olmayan yabancı malik). İşaretli portföy EİDS kontrolünden çıkar.';
comment on column public.properties.authority_last_email_at is 'Bu portföy için Bakanlık (EİDS) e-postasının son görüldüğü an.';

-- (3) olay defteri ----------------------------------------------------------------------------------------------------
create table if not exists public.eids_authority_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  kind text not null check (kind in ('grant', 'revoke', 'extend', 'expire', 'manual_set', 'link', 'undo', 'override')),
  source text not null check (source in ('email_verified', 'email_unverified', 'manual', 'document', 'portal_check', 'system')),
  inbound_message_id uuid,
  eids_property_no text check (eids_property_no is null or eids_property_no ~ '^[A-Z0-9-]{6,24}$'),
  deal_kind text check (deal_kind is null or deal_kind in ('sale', 'rent')),
  valid_until date,
  grantor_name_hash text check (grantor_name_hash is null or grantor_name_hash ~ '^[0-9a-f]{64}$'),
  grantor_masked text check (grantor_masked is null or char_length(grantor_masked) between 1 and 80),
  actor_id uuid,
  prev_status text check (prev_status is null or prev_status in ('unknown', 'pending', 'approved', 'expired', 'revoked', 'rejected')),
  new_status text check (new_status is null or new_status in ('unknown', 'pending', 'approved', 'expired', 'revoked', 'rejected')),
  prev_state jsonb not null default '{}'::jsonb,
  next_state jsonb not null default '{}'::jsonb,
  undo_of uuid references public.eids_authority_events(id) on delete cascade,
  evidence_media_id uuid,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  constraint eids_authority_events_undo_kind check ((kind = 'undo') = (undo_of is not null)),
  constraint eids_authority_events_override_note check (kind <> 'override' or char_length(btrim(coalesce(note, ''))) >= 10)
);

create unique index if not exists eids_authority_events_seq_key on public.eids_authority_events (seq);
create unique index if not exists eids_authority_events_undo_once on public.eids_authority_events (undo_of) where undo_of is not null;
create index if not exists eids_authority_events_property_idx on public.eids_authority_events (tenant_id, property_id, seq desc);
create index if not exists eids_authority_events_tenant_idx on public.eids_authority_events (tenant_id, created_at desc);
create index if not exists eids_authority_events_no_idx on public.eids_authority_events (tenant_id, eids_property_no) where eids_property_no is not null;

create or replace function public.eids_authority_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- FK eylemleri (RI tetiği içinden): portföy silinince property_id boşalır, ofis silinince satırlar gider.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and old.property_id is not null and new.property_id is null
     and (to_jsonb(new) - 'property_id') = (to_jsonb(old) - 'property_id') then
    return new;
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'eids_authority_events yalniz eklenir: % yasak.', tg_op using errcode = '42501';
end;
$$;

revoke all privileges on function public.eids_authority_events_append_only() from public, anon, authenticated, service_role;

drop trigger if exists trg_eids_authority_events_append_only on public.eids_authority_events;
create trigger trg_eids_authority_events_append_only
  before update or delete on public.eids_authority_events
  for each row execute function public.eids_authority_events_append_only();

drop trigger if exists trg_eids_authority_events_no_truncate on public.eids_authority_events;
create trigger trg_eids_authority_events_no_truncate
  before truncate on public.eids_authority_events
  for each statement execute function public.eids_authority_events_append_only();

alter table public.eids_authority_events enable row level security;

drop policy if exists eids_authority_events_select on public.eids_authority_events;
create policy eids_authority_events_select on public.eids_authority_events
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('portals', 'view'));

-- Doğrudan ekleme YOK: olay yalnız SECURITY DEFINER RPC'lerden yazılır (aksi halde danışman kendi uid'iyle sahte
-- override ya da undo satırı ekleyip yayın engelini aşabilir / meşru geri almayı kilitleyebilirdi).
drop policy if exists eids_authority_events_insert on public.eids_authority_events;

revoke all on table public.eids_authority_events from public, anon, authenticated, service_role;
grant select on table public.eids_authority_events to authenticated;
grant select on table public.eids_authority_events to service_role;

comment on table public.eids_authority_events is
  'EİDS yetki defteri. YALNIZ EKLENİR (trg_eids_authority_events_append_only). Yazma eids_apply_authority_event / eids_undo_authority_event üzerinden (src/lib/eids/ledger.ts).';

-- (4) tek yazma noktası -----------------------------------------------------------------------------------------------
-- Portföyün yetki alanlarının anlık görüntüsü (prev_state / next_state). Zaman damgaları UTC metnine sabitlenir:
-- geri almadaki "olaydan sonra değişti mi" karşılaştırması oturum saat diliminden etkilenmez. Yalnız RPC'ler çağırır.
create or replace function public.eids_authority_snapshot(p_property_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p.authority_eids_status,
    'source', p.authority_eids_source,
    'authorization_start', p.authorization_start,
    'authorization_end', p.authorization_end,
    'verified_at', pg_catalog.to_char(p.authority_eids_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'eids_property_no', p.eids_property_no,
    'exempt_reason', p.eids_exempt_reason,
    'grantor_masked', p.authority_grantor_masked,
    'last_email_at', pg_catalog.to_char(p.authority_last_email_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'owner_approved_at', pg_catalog.to_char(p.authority_owner_approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  from public.properties p
  where p.id = p_property_id
$$;

revoke all on function public.eids_authority_snapshot(uuid) from public, anon, authenticated, service_role;

create or replace function public.eids_apply_authority_event(p_tenant_id uuid, p_property_id uuid, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text := coalesce(p_event ->> 'kind', '');
  v_source text := coalesce(nullif(p_event ->> 'source', ''), 'manual');
  v_new_status text := nullif(p_event ->> 'new_status', '');
  v_deal text := nullif(p_event ->> 'deal_kind', '');
  v_no text := nullif(p_event ->> 'eids_property_no', '');
  v_bind boolean := coalesce((p_event ->> 'bind_property_no')::boolean, false);
  v_set_end boolean := coalesce((p_event ->> 'set_valid_until')::boolean, false);
  v_valid_until date := nullif(p_event ->> 'valid_until', '')::date;
  v_set_start boolean := coalesce((p_event ->> 'set_valid_from')::boolean, false);
  v_valid_from date := nullif(p_event ->> 'valid_from', '')::date;
  v_exempt_set boolean := p_event ? 'exempt_reason';
  v_exempt text := nullif(p_event ->> 'exempt_reason', '');
  v_verified boolean := coalesce((p_event ->> 'verified')::boolean, false);
  v_email_seen boolean := coalesce((p_event ->> 'email_seen')::boolean, false);
  v_masked text := nullif(p_event ->> 'grantor_masked', '');
  v_note text := nullif(btrim(coalesce(p_event ->> 'note', '')), '');
  v_evidence uuid := nullif(p_event ->> 'evidence_media_id', '')::uuid;
  v_actor uuid;
  v_prop record;
  v_prev jsonb;
  v_next jsonb;
  v_prev_status text;
  v_event_id uuid;
begin
  if p_tenant_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  -- SECURITY DEFINER: RLS uygulanmaz, denetimler burada AÇIKTIR (kiracı, izin, rol).
  if v_uid is not null then
    if p_tenant_id is distinct from public.current_tenant_id() or not public.has_effective_permission('portals', 'edit') then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
    v_actor := v_uid;
  elsif coalesce(auth.role(), '') = 'service_role' then
    v_actor := nullif(p_event ->> 'actor_id', '')::uuid;
  else
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if v_kind not in ('grant', 'revoke', 'extend', 'expire', 'manual_set', 'link', 'override')
     or v_source not in ('email_verified', 'email_unverified', 'manual', 'document', 'portal_check', 'system')
     or (v_new_status is not null and v_new_status not in ('unknown', 'pending', 'approved', 'expired', 'revoked', 'rejected'))
     or (v_deal is not null and v_deal not in ('sale', 'rent'))
     or (v_exempt is not null and v_exempt not in ('no_deed', 'foreign_owner'))
     or (v_no is not null and v_no !~ '^[A-Z0-9-]{6,24}$')
     or (v_set_start and v_valid_from is null) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if v_kind = 'override' then
    if v_uid is not null and public.current_profile_role() <> 'owner' then
      return jsonb_build_object('outcome', 'owner_only');
    end if;
    if char_length(coalesce(v_note, '')) < 10 then
      return jsonb_build_object('outcome', 'note_required');
    end if;
  elsif p_property_id is not null and v_uid is not null and not public.has_effective_permission('properties', 'edit') then
    -- Portföyü değiştiren olay: properties RLS UPDATE politikasının (properties:edit) birebir karşılığı.
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  -- Portföysüz olay (eşleşmeyen e-posta kaydı): yalnız iz düşülür.
  if p_property_id is null then
    if v_kind in ('override', 'link', 'manual_set') then
      return jsonb_build_object('outcome', 'invalid_input');
    end if;
    insert into public.eids_authority_events (
      tenant_id, property_id, kind, source, inbound_message_id, eids_property_no, deal_kind, valid_until,
      grantor_name_hash, grantor_masked, actor_id, prev_status, new_status, prev_state, note
    ) values (
      p_tenant_id, null, v_kind, v_source, nullif(p_event ->> 'inbound_message_id', '')::uuid, v_no, v_deal, v_valid_until,
      nullif(p_event ->> 'grantor_name_hash', ''), v_masked, v_actor, null, v_new_status, '{}'::jsonb, v_note
    ) returning id into v_event_id;
    return jsonb_build_object('outcome', 'logged', 'event_id', v_event_id);
  end if;

  select id, authority_eids_status, eids_property_no
    into v_prop
    from public.properties
   where id = p_property_id and tenant_id = p_tenant_id and deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  -- Kanıt (e-Devlet ekran görüntüsü) yalnız bu portföyün medyası olabilir.
  if v_evidence is not null and not exists (
    select 1 from public.property_media m
    where m.id = v_evidence and m.property_id = p_property_id and m.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  v_prev_status := v_prop.authority_eids_status;
  v_prev := public.eids_authority_snapshot(p_property_id);

  if v_bind and v_no is not null and v_prop.eids_property_no is not null and v_prop.eids_property_no <> v_no then
    return jsonb_build_object('outcome', 'no_conflict', 'current_no', v_prop.eids_property_no);
  end if;

  if v_kind <> 'override' then
    update public.properties set
      authority_eids_status = coalesce(v_new_status, authority_eids_status),
      authority_eids_source = case when v_new_status is not null then v_source else authority_eids_source end,
      authorization_start = case when v_set_start then v_valid_from else authorization_start end,
      authorization_end = case when v_set_end then v_valid_until else authorization_end end,
      authority_eids_verified_at = case when v_verified then now() else authority_eids_verified_at end,
      authority_last_email_at = case when v_email_seen then now() else authority_last_email_at end,
      authority_grantor_masked = coalesce(v_masked, authority_grantor_masked),
      eids_property_no = case when v_bind and v_no is not null then v_no else eids_property_no end,
      eids_exempt_reason = case when v_exempt_set then v_exempt else eids_exempt_reason end,
      authority_owner_approved_at = case
        when v_new_status = 'approved' and v_prev_status is distinct from 'approved' then now()
        when v_new_status is not null and v_new_status <> 'approved' then null
        else authority_owner_approved_at end
    where id = p_property_id and tenant_id = p_tenant_id;
    if not found then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    v_next := public.eids_authority_snapshot(p_property_id);
  else
    v_next := v_prev;
  end if;

  insert into public.eids_authority_events (
    tenant_id, property_id, kind, source, inbound_message_id, eids_property_no, deal_kind, valid_until,
    grantor_name_hash, grantor_masked, actor_id, prev_status, new_status, prev_state, next_state, evidence_media_id, note
  ) values (
    p_tenant_id, p_property_id, v_kind, v_source, nullif(p_event ->> 'inbound_message_id', '')::uuid,
    coalesce(v_no, v_prop.eids_property_no), v_deal, v_valid_until,
    nullif(p_event ->> 'grantor_name_hash', ''), v_masked, v_actor, v_prev_status,
    case when v_kind = 'override' then v_prev_status else coalesce(v_new_status, v_prev_status) end,
    v_prev, v_next, v_evidence, v_note
  ) returning id into v_event_id;

  return jsonb_build_object(
    'outcome', 'applied', 'event_id', v_event_id, 'prev_status', v_prev_status,
    'new_status', case when v_kind = 'override' then v_prev_status else coalesce(v_new_status, v_prev_status) end
  );
end;
$$;

create or replace function public.eids_undo_authority_event(p_tenant_id uuid, p_event_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_ev record;
  v_prop record;
  v_latest uuid;
  v_s jsonb;
  v_n jsonb;
  v_cur jsonb;
  v_changed jsonb;
  v_restored text;
  v_after jsonb;
  v_event_id uuid;
begin
  if p_tenant_id is null or p_event_id is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  -- SECURITY DEFINER: denetimler açık (kiracı + portals:edit + properties:edit; geri alma portföyü değiştirir).
  if v_uid is not null then
    if p_tenant_id is distinct from public.current_tenant_id()
       or not public.has_effective_permission('portals', 'edit')
       or not public.has_effective_permission('properties', 'edit') then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
    v_actor := v_uid;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select id, property_id, kind, prev_state, next_state, eids_property_no, deal_kind
    into v_ev
    from public.eids_authority_events
   where id = p_event_id and tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_ev.kind in ('undo', 'override') or v_ev.property_id is null then
    return jsonb_build_object('outcome', 'not_undoable');
  end if;

  -- Önce portföy kilitlenir: aynı anda gelen yeni olay "son olay" denetimini bozamaz.
  select id, authority_eids_status
    into v_prop
    from public.properties
   where id = v_ev.property_id and tenant_id = p_tenant_id and deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if exists (select 1 from public.eids_authority_events e where e.undo_of = p_event_id) then
    return jsonb_build_object('outcome', 'already_undone');
  end if;
  select e.id into v_latest
    from public.eids_authority_events e
   where e.tenant_id = p_tenant_id and e.property_id = v_ev.property_id and e.kind <> 'override'
   order by e.seq desc
   limit 1;
  if v_latest is distinct from p_event_id then
    return jsonb_build_object('outcome', 'superseded');
  end if;

  v_s := coalesce(v_ev.prev_state, '{}'::jsonb);
  v_n := coalesce(v_ev.next_state, '{}'::jsonb);
  v_cur := public.eids_authority_snapshot(v_ev.property_id);
  -- Olayın GERÇEKTEN değiştirdiği alanlar; yalnız bunlar geri yüklenir.
  select coalesce(jsonb_agg(n.key), '[]'::jsonb) into v_changed
    from jsonb_each(v_n) n
   where n.value is distinct from v_s -> n.key;
  -- Bu alanlardan biri olaydan sonra defter dışından (ör. portföy formu) değiştirildiyse ezilmez.
  if exists (
    select 1 from jsonb_array_elements_text(v_changed) k(key)
    where v_n -> k.key is distinct from v_cur -> k.key
  ) then
    return jsonb_build_object('outcome', 'changed_outside');
  end if;

  v_restored := case when v_changed ? 'status' then coalesce(v_s ->> 'status', v_prop.authority_eids_status) else v_prop.authority_eids_status end;

  update public.properties set
    authority_eids_status = v_restored,
    authority_eids_source = case when v_changed ? 'source' then v_s ->> 'source' else authority_eids_source end,
    authorization_start = case when v_changed ? 'authorization_start' then (v_s ->> 'authorization_start')::date else authorization_start end,
    authorization_end = case when v_changed ? 'authorization_end' then (v_s ->> 'authorization_end')::date else authorization_end end,
    authority_eids_verified_at = case when v_changed ? 'verified_at' then (v_s ->> 'verified_at')::timestamptz else authority_eids_verified_at end,
    eids_property_no = case when v_changed ? 'eids_property_no' then v_s ->> 'eids_property_no' else eids_property_no end,
    eids_exempt_reason = case when v_changed ? 'exempt_reason' then v_s ->> 'exempt_reason' else eids_exempt_reason end,
    authority_grantor_masked = case when v_changed ? 'grantor_masked' then v_s ->> 'grantor_masked' else authority_grantor_masked end,
    authority_last_email_at = case when v_changed ? 'last_email_at' then (v_s ->> 'last_email_at')::timestamptz else authority_last_email_at end,
    authority_owner_approved_at = case when v_changed ? 'owner_approved_at' then (v_s ->> 'owner_approved_at')::timestamptz else authority_owner_approved_at end
  where id = v_ev.property_id and tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  v_after := public.eids_authority_snapshot(v_ev.property_id);

  insert into public.eids_authority_events (
    tenant_id, property_id, kind, source, eids_property_no, deal_kind, actor_id, prev_status, new_status, prev_state, next_state, undo_of, note
  ) values (
    p_tenant_id, v_ev.property_id, 'undo', case when v_uid is null then 'system' else 'manual' end,
    v_ev.eids_property_no, v_ev.deal_kind, v_actor, v_prop.authority_eids_status, v_restored, v_cur, v_after, p_event_id,
    nullif(btrim(coalesce(p_note, '')), '')
  ) returning id into v_event_id;

  return jsonb_build_object('outcome', 'applied', 'event_id', v_event_id, 'prev_status', v_prop.authority_eids_status, 'new_status', v_restored);
end;
$$;

revoke all on function public.eids_apply_authority_event(uuid, uuid, jsonb) from public, anon;
revoke all on function public.eids_undo_authority_event(uuid, uuid, text) from public, anon;
grant execute on function public.eids_apply_authority_event(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.eids_undo_authority_event(uuid, uuid, text) to authenticated, service_role;

-- (5) aday ön süzgeci (pg_trgm varsa) ---------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    if not exists (
      select 1 from pg_catalog.pg_indexes
      where schemaname = 'public' and tablename = 'customers' and indexdef ilike '%full_name%gin_trgm_ops%'
    ) then
      execute 'create index if not exists idx_customers_full_name_trgm on public.customers using gin (full_name gin_trgm_ops)';
    end if;
    execute $fn$
      create or replace function public.eids_authority_candidates(p_tenant_id uuid, p_grantor_name text, p_limit integer default 40)
      returns table (property_id uuid, name_similarity real)
      language sql
      stable
      security invoker
      set search_path = ''
      as $body$
        select p.id, max(public.similarity(lower(c.full_name), lower(p_grantor_name)))::real
        from public.customers c
        join public.properties p
          on p.tenant_id = c.tenant_id
         and (p.owner_customer_id = c.id
              or exists (select 1 from public.property_owner_info o
                         where o.property_id = p.id and o.tenant_id = p.tenant_id and o.customer_id = c.id))
        where c.tenant_id = p_tenant_id
          and c.deleted_at is null
          and p.deleted_at is null
          and char_length(btrim(coalesce(p_grantor_name, ''))) >= 3
          and c.full_name operator(public.%) p_grantor_name
        group by p.id
        order by 2 desc
        limit least(greatest(coalesce(p_limit, 40), 1), 100)
      $body$
    $fn$;
    execute 'revoke all on function public.eids_authority_candidates(uuid, text, integer) from public, anon';
    execute 'grant execute on function public.eids_authority_candidates(uuid, text, integer) to authenticated, service_role';
  end if;
end $$;

-- (6) taşınmaz no rakam anahtarıyla birebir arama ---------------------------------------------------------------------
-- Uygulamadaki eidsNoMatchKey ile aynı anahtar: YALNIZ rakamlar (baştaki sıfırlar korunur). "EIDS-34-4410-0141" kaydı
-- "3444100141" anahtarıyla bulunur; ayraç nereye düşerse düşsün kaçmaz.
create index if not exists properties_eids_no_key_idx
  on public.properties (tenant_id, (pg_catalog.regexp_replace(eids_property_no, '\D', '', 'g')))
  where eids_property_no is not null and deleted_at is null;

create or replace function public.eids_properties_by_no_key(p_tenant_id uuid, p_key text)
returns setof public.properties
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.properties p
  where p.tenant_id = p_tenant_id
    and p.deleted_at is null
    and p.eids_property_no is not null
    and p_key ~ '^[0-9]{6,24}$'
    and pg_catalog.regexp_replace(p.eids_property_no, '\D', '', 'g') = p_key
  limit 50
$$;

revoke all on function public.eids_properties_by_no_key(uuid, text) from public, anon;
grant execute on function public.eids_properties_by_no_key(uuid, text) to authenticated, service_role;
