-- MIGRATION 20261012000800_property_price_proposals.sql (Konsey ertelenen #7: fiyat revizyonu onerisi + mulk sahibi onayi)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012000800_property_price_proposals.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012000800_property_price_proposals.rollback.sql
--
-- NEDEN: Fiyat guncelleme kararinda mulk sahibi surecin disindaydi (telefonla "olur" denir, iz kalmazdi).
--   Danisman "Fiyat revizyonu oner" der (yeni fiyat + gerekce + varsa emsal kaniti); mulk sahibi malik portalinda
--   onaylar / reddeder / not ekler. Onayda portfoy fiyati AYNI islemde guncellenir ve fiyat izine yazilir.
-- NE YAPAR:
--   1. property_price_proposals (tenant, property, proposed_by, old/new price, reason, comparables_snapshot jsonb,
--      status pending|approved|rejected|expired, owner_note, decided_at, expires_at = olusturma + 14 gun).
--      Portfoy basina TEK bekleyen oneri (kismi tekil indeks). RLS: kiraci ici SELECT (properties:view); yazma YOK.
--   2. create_property_price_proposal(...) (authenticated): properties:edit yetkisi + portfoy ayni ofiste + aktif malik portali
--      baglantisi sart; suresi dolan bekleyeni 'expired' yapar. cancel_property_price_proposal(...) bekleyeni iptal eder.
--   3. decide_property_price_proposal_by_token(...) (anon/authenticated/service_role): token ICERIDE dogrulanir (gecerli,
--      suresiz, ofis aktif); oneri YALNIZ o tokenin portfoyune aitse gorulur (KVKK). approved: portfoy list_price ayni
--      islemde guncellenir + fiyat izi gerekcesi; rejected/note: danismana bildirim + gorev. Danismana HER karar bildirim.
--   4. guard_property_list_price_drop(): ayni islemde onaylanmis ve tam bu fiyati hedefleyen oneri MESRU GEREKCE sayilir
--      (ofis esik-ustu dusus onayi kurali mulk sahibi onayini da kabul eder). Onay yalniz token'li RPC ile yazilir;
--      authenticated tabloya yazamaz, dolayisiyla kapi sahte onerile asilamaz.
-- BAGIMLILIK: properties, property_price_history (20260725000049), guard_property_list_price_drop (20261007000800),
--   owner_portal_tokens (20260723000033), notifications, tasks.
-- ETKI: ek (yeni tablo/RPC) + guard govdesi yalniz bir erken-donus kosulu kazanir (kural kapaliyken davranis ayni).
-- RISK: dusuk. Anon'a yeni bir RPC acilir; token + oneri id'si birlikte dogrulanir, yalniz o portfoyun fiyatini ve yalniz
--   danisman tarafindan hazirlanmis onerinin fiyatini uygular.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.property_price_history') is null
     or pg_catalog.to_regclass('public.owner_portal_tokens') is null
     or pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('public.tasks') is null
     or pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regprocedure('public.guard_property_list_price_drop()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception '20261012000800: properties/property_price_history/owner_portal_tokens/notifications/tasks veya guard_property_list_price_drop yok; once 20261007000800 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Tablo
-- ---------------------------------------------------------------------------
create table if not exists public.property_price_proposals (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  property_id           uuid not null references public.properties(id) on delete cascade,
  proposed_by           uuid references public.profiles(id) on delete set null,
  old_price             numeric(14,2) not null check (old_price > 0),
  new_price             numeric(14,2) not null check (new_price > 0 and new_price <= 1000000000000),
  reason                text not null check (char_length(btrim(reason)) between 3 and 1000),
  comparables_snapshot  jsonb check (comparables_snapshot is null or jsonb_typeof(comparables_snapshot) = 'object'),
  status                text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  owner_note            text check (owner_note is null or char_length(owner_note) <= 500),
  decided_at            timestamptz,
  expires_at            timestamptz not null default (now() + interval '14 days'),
  created_at            timestamptz not null default now(),
  check (new_price <> old_price)
);
create unique index if not exists uq_property_price_proposals_pending
  on public.property_price_proposals (property_id) where status = 'pending';
create index if not exists idx_property_price_proposals_property
  on public.property_price_proposals (property_id, created_at desc);
create index if not exists idx_property_price_proposals_tenant
  on public.property_price_proposals (tenant_id, status, created_at desc);
create index if not exists idx_property_price_proposals_proposed_by
  on public.property_price_proposals (proposed_by) where proposed_by is not null;

alter table public.property_price_proposals enable row level security;
drop policy if exists property_price_proposals_select on public.property_price_proposals;
create policy property_price_proposals_select on public.property_price_proposals for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'view')));
revoke all on table public.property_price_proposals from public, anon, authenticated;
grant select on table public.property_price_proposals to authenticated;
grant all on table public.property_price_proposals to service_role;

comment on table public.property_price_proposals is
  'Danismanin mulk sahibine gonderdigi fiyat revizyonu onerisi. Yazma yalniz create_/cancel_/decide_ RPC''leri (SECURITY DEFINER); portfoy basina tek bekleyen oneri; 14 gun sonra expired.';

-- ---------------------------------------------------------------------------
-- 2) Danisman: oneri olustur / iptal et
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
   where property_id = p_property_id and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.property_price_proposals x where x.property_id = p_property_id and x.status = 'pending') then
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
   where id = p_proposal_id and tenant_id = v_tenant and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Mulk sahibi: token ile karar (onayla / reddet / not ekle)
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
    update public.property_price_proposals
       set status = 'approved', decided_at = now(), owner_note = v_note
     where id = v_prop.id;
    -- Fiyat kapisi (guard_property_list_price_drop) bu islemde 'approved' + decided_at = now() onerisini mesru gerekce sayar.
    update public.properties set list_price = v_prop.new_price where id = v_property and tenant_id = v_tenant;
    update public.property_price_history
       set reason = 'Mülk sahibi onaylı fiyat revizyonu'
     where id = (
       select h.id from public.property_price_history h
        where h.property_id = v_property and h.price_field = 'list_price' and h.created_at = now() and h.new_price = v_prop.new_price
        order by h.id limit 1
     );
    v_title := 'Mülk sahibi fiyat önerisini onayladı';
    v_body := left(v_label || ' · ' || v_money_old || ' TL → ' || v_money_new || ' TL. Portföy fiyatı güncellendi.'
      || coalesce(' Not: ' || v_note, ''), 900);
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
         case when v_decision = 'approved' then 'success' when v_decision = 'rejected' then 'warning' else 'info' end,
         jsonb_build_object('source', 'price_proposal', 'proposal_id', v_prop.id, 'decision', v_decision)
    from (values (v_user), (v_other)) x(u)
   where x.u is not null;

  if v_decision in ('rejected', 'note') and v_user is not null then
    insert into public.tasks (tenant_id, title, notes, kind, priority, status, due_at, assigned_to, property_id)
    values (v_tenant,
            case when v_decision = 'rejected' then 'Mülk sahibiyle fiyatı görüş' else 'Mülk sahibinin fiyat notunu yanıtla' end,
            v_body, 'call', 'high', 'open', now() + interval '1 day', v_user, v_property);
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'decision', v_decision);
end;
$$;

revoke all on function public.create_property_price_proposal(uuid, numeric, text, jsonb) from public, anon;
grant execute on function public.create_property_price_proposal(uuid, numeric, text, jsonb) to authenticated, service_role;
revoke all on function public.cancel_property_price_proposal(uuid) from public, anon;
grant execute on function public.cancel_property_price_proposal(uuid) to authenticated, service_role;
revoke all on function public.decide_property_price_proposal_by_token(text, uuid, text, text) from public;
grant execute on function public.decide_property_price_proposal_by_token(text, uuid, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Fiyat dusurme kapisi: mulk sahibi onayli oneri mesru gerekce (govde 20261007000800 ile ayni + 1 erken donus)
-- ---------------------------------------------------------------------------
create or replace function public.guard_property_list_price_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rule jsonb;
  v_raw text;
  v_threshold numeric := 15;
  v_drop_pct numeric;
  v_ref numeric;
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

  -- Mulk sahibi onayli fiyat onerisi (20261012000800): AYNI islemde onaylanmis ve tam bu fiyati hedefleyen oneri mesru gerekcedir.
  -- Onay yalniz token'li RPC ile yazilir (authenticated tabloya yazamaz); decided_at = now() ayni islemi sart kosar.
  if new.list_price is not null and exists (
    select 1 from public.property_price_proposals pp
     where pp.property_id = old.id and pp.tenant_id = old.tenant_id
       and pp.status = 'approved' and pp.decided_at = now() and pp.new_price = new.list_price
  ) then
    return new;
  end if;

  -- Referans fiyat: mevcut deger ile son 30 gunluk tarihcedeki en yuksek liste fiyati. Esik altindaki ardisik
  -- kucuk dususler (kumulatif) ve "once NULL, sonra dusuk deger" yolu bu referansa gore olculur.
  select max(x.p) into v_ref
    from (
      select old.list_price as p
      union all
      select greatest(h.old_price, h.new_price)
        from public.property_price_history h
       where h.property_id = old.id
         and h.price_field = 'list_price'
         and h.created_at > now() - interval '30 days'
    ) x;
  if v_ref is null or v_ref <= 0 then
    return new;
  end if;
  if new.list_price is not null and new.list_price >= v_ref then
    return new;
  end if;

  select s.approval_rules -> 'price_drop' into v_rule
    from public.oversight_settings s
   where s.tenant_id = old.tenant_id;

  -- Kural yok/kapali: uygulama katmaniyla ayni (varsayilan KAPALI).
  if v_rule is null
     or jsonb_typeof(v_rule) <> 'object'
     or jsonb_typeof(v_rule -> 'enabled') is distinct from 'boolean'
     or (v_rule ->> 'enabled') <> 'true' then
    return new;
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

  v_drop_pct := (v_ref - coalesce(new.list_price, 0)) / v_ref * 100;
  if v_drop_pct < v_threshold then
    return new;
  end if;

  -- Muafiyet: yalniz owner/gm (src/lib/team/assignable-roles.ts APPROVAL_EXEMPT_ROLES).
  if public.current_profile_role() in ('owner', 'gm') then
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

revoke all on function public.guard_property_list_price_drop() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select count(*) from pg_policy where polrelid = 'public.property_price_proposals'::regclass;  -- BEKLENEN: 1
-- select proname from pg_proc where proname like '%price_proposal%';
