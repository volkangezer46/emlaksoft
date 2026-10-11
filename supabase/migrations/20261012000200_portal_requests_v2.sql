-- Portal istekleri v2 (Konsey Tur 3): gösterim talebi, arayış güncelleme isteği, kiracı "Ödedim" bildirimi + malik haftalık rapor anahtarı.
--
-- NEDEN: Müşteri portalı alıcıya yalnız teklif/erteleme veriyordu. (1) Önerilen ilanda "Görmek istiyorum" danışmana tek tıkla
--   gösterim talebi; (2) "Arayışımı güncelle" bütçe/bölge/oda isteği (DOĞRUDAN YAZMA YOK: danışman onaylayınca talep güncellenir);
--   (3) kiracı "Ödedim" der -> kira tahsilatı "teyit bekliyor" (tahakkuk 'paid' OLMAZ; danışman teyit eder, ekstrede eşleşen satır önerilir);
--   (4) malik haftalık raporu portföy bazında tek tık açılır/kapanır (mevcut haftalik-ozet cron adımı; YENİ cron yok).
-- DEĞİŞENLER:
--   - portal_customer_requests.kind CHECK: + 'visit', 'demand_update', 'rent_paid'.
--   - portal_demand_updates (bekleyen/onaylanan/reddedilen arayış güncelleme istekleri) ve rent_payment_notices ("Ödedim" bildirimleri).
--     Yazma YALNIZ portal_customer_request RPC'si (token içeride doğrulanır); ofis okur, yalnız karar sütunlarını günceller.
--   - portal_customer_request: aynı imza, yeni üç tür. Frenler aynı (müşteri başına 24 saatte 10 istek, aynı kayda 10 dk).
--   - owner_portal_tokens.weekly_report_enabled (boolean, null = ofis ayarına uy; true/false = bu portföy için açık/kapalı).
-- BAGIMLILIK: 20261007000620 (portal_customer_request + iz tablosu), customer_demands (init), rent_charges/rentals (20260726000074),
--   tasks (20260722000022), notifications, owner_portal_tokens (20260723000033).
-- GERI ALMA: rollbacks/20261012000200_portal_requests_v2.rollback.sql (RPC önceki gövdeye döner; yeni tablolar/sütun düşer).
-- RISK: düşük-orta (anon'a açık RPC genişler; yeni türler yalnız o müşterinin kaydına bağlı görev/istek/bildirim yazar, mevcut kaydı DEĞİŞTİRMEZ).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.portal_customer_request(text,text,jsonb)') is null
     or pg_catalog.to_regclass('public.portal_customer_requests') is null
     or pg_catalog.to_regclass('public.customer_demands') is null
     or pg_catalog.to_regclass('public.rent_charges') is null
     or pg_catalog.to_regclass('public.owner_portal_tokens') is null then
    raise exception 'portal_customer_request / portal_customer_requests / customer_demands / rent_charges / owner_portal_tokens yok.';
  end if;
end $$;

-- 1) Tür kısıtı genişler
alter table public.portal_customer_requests drop constraint if exists portal_customer_requests_kind_check;
alter table public.portal_customer_requests add constraint portal_customer_requests_kind_check
  check (kind in ('offer', 'reschedule', 'cancel', 'maintenance', 'visit', 'demand_update', 'rent_paid'));

-- 2) Arayış güncelleme istekleri
create table if not exists public.portal_demand_updates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  demand_id   uuid not null references public.customer_demands(id) on delete cascade,
  budget_min  numeric(14,2) check (budget_min is null or budget_min >= 0),
  budget_max  numeric(14,2) check (budget_max is null or budget_max >= 0),
  rooms       text check (rooms is null or char_length(rooms) <= 20),
  area_text   text check (area_text is null or char_length(area_text) <= 120),
  note        text check (note is null or char_length(note) <= 500),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_portal_demand_updates_pending on public.portal_demand_updates (demand_id) where status = 'pending';
create index if not exists idx_portal_demand_updates_tenant on public.portal_demand_updates (tenant_id, status, created_at desc);
create index if not exists idx_portal_demand_updates_customer on public.portal_demand_updates (customer_id, created_at desc);

-- 3) Kiracı "Ödedim" bildirimleri
create table if not exists public.rent_payment_notices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  rental_id   uuid not null references public.rentals(id) on delete cascade,
  charge_id   uuid not null references public.rent_charges(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  reference   text check (reference is null or char_length(reference) <= 120),
  note        text check (note is null or char_length(note) <= 500),
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_rent_payment_notices_pending on public.rent_payment_notices (charge_id) where status = 'pending';
create index if not exists idx_rent_payment_notices_tenant on public.rent_payment_notices (tenant_id, status, created_at desc);
create index if not exists idx_rent_payment_notices_rental on public.rent_payment_notices (rental_id, created_at desc);

-- RLS: ofis okur (modül yetkisiyle); yalnız karar sütunlarını günceller; satırı yalnız RPC yazar.
alter table public.portal_demand_updates enable row level security;
drop policy if exists portal_demand_updates_select on public.portal_demand_updates;
create policy portal_demand_updates_select on public.portal_demand_updates for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'view')));
drop policy if exists portal_demand_updates_update on public.portal_demand_updates;
create policy portal_demand_updates_update on public.portal_demand_updates for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')))
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')));
revoke all on table public.portal_demand_updates from public, anon;
grant select on table public.portal_demand_updates to authenticated;
grant update (status, decided_by, decided_at) on table public.portal_demand_updates to authenticated;
grant all on table public.portal_demand_updates to service_role;

alter table public.rent_payment_notices enable row level security;
drop policy if exists rent_payment_notices_select on public.rent_payment_notices;
create policy rent_payment_notices_select on public.rent_payment_notices for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));
drop policy if exists rent_payment_notices_update on public.rent_payment_notices;
create policy rent_payment_notices_update on public.rent_payment_notices for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')))
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
revoke all on table public.rent_payment_notices from public, anon;
grant select on table public.rent_payment_notices to authenticated;
grant update (status, decided_by, decided_at) on table public.rent_payment_notices to authenticated;
grant all on table public.rent_payment_notices to service_role;

-- 4) Malik haftalık rapor: portföy (belirteç) bazında anahtar (null = ofis ayarına uy)
alter table public.owner_portal_tokens add column if not exists weekly_report_enabled boolean;
comment on column public.owner_portal_tokens.weekly_report_enabled is 'Haftalık rapor anahtarı: null = ofis ayarına uy; true = bu portföy için açık; false = kapalı.';

-- 5) RPC: aynı imza, üç yeni tür
create or replace function public.portal_customer_request(p_token text, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_cust_name text;
  v_cust_advisor uuid;
  v_recent integer;
  v_ref uuid;
  v_note text := left(btrim(coalesce(p_payload ->> 'note', '')), 500);
  v_id uuid;
  v_user uuid;
  v_title text;
  v_body text;
  v_href text;
  p record;
  a record;
  r record;
  d record;
  c record;
  v_amount numeric;
  v_mtitle text;
  v_bmin numeric;
  v_bmax numeric;
  v_rooms text;
  v_area text;
  v_pref text;
  v_due timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  if p_kind not in ('offer', 'reschedule', 'cancel', 'maintenance', 'visit', 'demand_update', 'rent_paid')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select cpt.tenant_id, cpt.customer_id into v_tenant, v_customer
    from public.customer_portal_tokens cpt
    join public.tenants tn on tn.id = cpt.tenant_id
   where cpt.token = p_token and cpt.expires_at > now() and tn.status in ('active', 'trial', 'past_due');
  if v_customer is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  select cu.full_name, cu.assigned_to into v_cust_name, v_cust_advisor
    from public.customers cu
   where cu.id = v_customer and cu.tenant_id = v_tenant and cu.is_sample = false and cu.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;

  begin
    v_ref := nullif(coalesce(p_payload ->> 'property_id', p_payload ->> 'appointment_id', p_payload ->> 'rental_id',
                             p_payload ->> 'demand_id', p_payload ->> 'charge_id'), '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end;
  if v_ref is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Girdi doğrulaması frenlerden ÖNCE (geçersiz istek iz bırakmaz).
  if p_kind = 'offer' then
    begin
      v_amount := round((p_payload ->> 'amount')::numeric, 2);
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end;
    if v_amount is null or v_amount < 1 or v_amount > 1000000000000 then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end if;
  elsif p_kind = 'maintenance' then
    v_mtitle := left(btrim(coalesce(p_payload ->> 'title', '')), 120);
    if char_length(v_mtitle) < 3 then
      return jsonb_build_object('ok', false, 'code', 'invalid_title');
    end if;
  elsif p_kind = 'demand_update' then
    begin
      v_bmin := nullif(btrim(coalesce(p_payload ->> 'budget_min', '')), '')::numeric;
      v_bmax := nullif(btrim(coalesce(p_payload ->> 'budget_max', '')), '')::numeric;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end;
    v_rooms := nullif(left(btrim(coalesce(p_payload ->> 'rooms', '')), 20), '');
    v_area := nullif(left(btrim(coalesce(p_payload ->> 'area', '')), 120), '');
    if (v_bmin is not null and (v_bmin < 0 or v_bmin > 1000000000000))
       or (v_bmax is not null and (v_bmax < 0 or v_bmax > 1000000000000))
       or (v_bmin is not null and v_bmax is not null and v_bmin > v_bmax) then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end if;
    if v_bmin is null and v_bmax is null and v_rooms is null and v_area is null then
      return jsonb_build_object('ok', false, 'code', 'nothing_to_update');
    end if;
  elsif p_kind = 'rent_paid' then
    begin
      v_amount := nullif(btrim(coalesce(p_payload ->> 'amount', '')), '')::numeric;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end;
    if v_amount is not null and (v_amount < 1 or v_amount > 1000000000000) then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end if;
  end if;

  -- Frenler: günlük tavan + aynı kayda kısa sürede tekrar.
  select count(*) into v_recent from public.portal_customer_requests q
   where q.customer_id = v_customer and q.created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if exists (select 1 from public.portal_customer_requests q
              where q.customer_id = v_customer and q.kind = p_kind and q.ref_id = v_ref and q.created_at > now() - interval '10 minutes') then
    return jsonb_build_object('ok', true, 'code', 'duplicate');
  end if;

  if p_kind = 'offer' then
    select pr.id, pr.property_code, pr.title, pr.assigned_to into p
      from public.properties pr
     where pr.id = v_ref and pr.tenant_id = v_tenant and pr.is_sample = false and pr.deleted_at is null
       and pr.status in ('live', 'reserved', 'Yayında');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    insert into public.offers (tenant_id, property_id, customer_id, amount, status, notes)
    values (v_tenant, p.id, v_customer, v_amount, 'draft', 'Müşteri portalından gelen teklif (danışman incelemesi bekliyor)')
    returning id into v_id;
    v_user := coalesce(v_cust_advisor, p.assigned_to);
    v_title := 'Portaldan yeni teklif';
    v_body := left(coalesce(v_cust_name, 'Müşteri') || ' · ' || coalesce(p.property_code, '') || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' TL'
      || case when v_note <> '' then ' · Not: ' || v_note else '' end, 900);
    v_href := '/app/teklifler?portfoy=' || p.id::text || '&musteri=' || v_customer::text;

  elsif p_kind = 'visit' then
    -- "Görmek istiyorum": yayındaki portföy için danışmana gösterim görevi (randevuyu danışman kurar; kendiliğinden randevu açılmaz).
    select pr.id, pr.property_code, pr.title, pr.assigned_to into p
      from public.properties pr
     where pr.id = v_ref and pr.tenant_id = v_tenant and pr.is_sample = false and pr.deleted_at is null
       and pr.status in ('live', 'reserved', 'Yayında');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    v_pref := left(btrim(coalesce(p_payload ->> 'preferred', '')), 120);
    v_user := coalesce(v_cust_advisor, p.assigned_to);
    v_title := 'Portaldan gösterim talebi';
    v_body := left(coalesce(v_cust_name, 'Müşteri') || ' · ' || coalesce(p.property_code, '') || coalesce(' · ' || nullif(p.title, ''), '')
      || case when v_pref <> '' then ' · Uygun zaman: ' || v_pref else '' end
      || case when v_note <> '' then ' · Not: ' || v_note else '' end, 900);
    insert into public.tasks (tenant_id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id)
    values (v_tenant, v_title, v_body, 'visit', 'high', 'open', now() + interval '4 hours', v_user, v_customer, p.id)
    returning id into v_id;
    v_href := '/app/gorevler?filter=open';

  elsif p_kind in ('reschedule', 'cancel') then
    select ap.id, ap.scheduled_at, ap.assigned_to, ap.property_id, ap.status into a
      from public.appointments ap
     where ap.id = v_ref and ap.tenant_id = v_tenant and ap.customer_id = v_customer
       and ap.scheduled_at > now() - interval '1 hour' and coalesce(ap.status, '') not in ('cancelled', 'done', 'completed');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    v_user := coalesce(a.assigned_to, v_cust_advisor);
    v_title := case when p_kind = 'cancel' then 'Randevu iptal talebi' else 'Randevu erteleme talebi' end;
    v_body := left(coalesce(v_cust_name, 'Müşteri') || ' · randevu ' || to_char(a.scheduled_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI')
      || case when btrim(coalesce(p_payload ->> 'preferred', '')) <> '' then ' · Uygun zaman: ' || left(btrim(p_payload ->> 'preferred'), 120) else '' end
      || case when v_note <> '' then ' · Not: ' || v_note else '' end, 900);
    insert into public.tasks (tenant_id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id)
    values (v_tenant, v_title, v_body, 'call', 'high', 'open', least(a.scheduled_at, now() + interval '4 hours'), v_user, v_customer, a.property_id)
    returning id into v_id;
    v_href := '/app/gorevler?filter=open';

  elsif p_kind = 'demand_update' then
    -- Arayış güncelleme: talep DEĞİŞMEZ; bekleyen istek yazılır (aynı talepte tek bekleyen istek: yenisi eskisinin üstüne yazar).
    select cd.id into d
      from public.customer_demands cd
     where cd.id = v_ref and cd.tenant_id = v_tenant and cd.customer_id = v_customer and cd.status in ('new', 'active', 'matched');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    update public.portal_demand_updates u
       set budget_min = v_bmin, budget_max = v_bmax, rooms = v_rooms, area_text = v_area, note = nullif(v_note, ''), created_at = now()
     where u.demand_id = d.id and u.status = 'pending'
    returning u.id into v_id;
    if v_id is null then
      insert into public.portal_demand_updates (tenant_id, customer_id, demand_id, budget_min, budget_max, rooms, area_text, note)
      values (v_tenant, v_customer, d.id, v_bmin, v_bmax, v_rooms, v_area, nullif(v_note, ''))
      returning id into v_id;
    end if;
    v_user := v_cust_advisor;
    v_title := 'Arayış güncelleme isteği';
    v_body := left(coalesce(v_cust_name, 'Müşteri') || ' · '
      || concat_ws(' · ',
           case when v_bmin is not null or v_bmax is not null
                then 'Bütçe ' || coalesce(to_char(v_bmin, 'FM999G999G999G990'), '—') || ' – ' || coalesce(to_char(v_bmax, 'FM999G999G999G990'), '—') || ' TL' end,
           case when v_rooms is not null then 'Oda ' || v_rooms end,
           case when v_area is not null then 'Bölge ' || v_area end,
           case when v_note <> '' then 'Not: ' || v_note end), 900);
    insert into public.tasks (tenant_id, title, notes, kind, priority, status, due_at, assigned_to, customer_id)
    values (v_tenant, v_title, v_body, 'followup', 'normal', 'open', now() + interval '1 day', v_user, v_customer);
    v_href := '/app/musteriler/' || v_customer::text || '#portal-istekleri';

  elsif p_kind = 'rent_paid' then
    -- "Ödedim": tahakkuk 'paid' OLMAZ; teyit bekleyen bildirim yazılır. Tahakkuk bu müşterinin aktif kira kaydına ait ve ödenmemiş olmalı.
    select ch.id, ch.rental_id, ch.amount, ch.period, rn.property_id, rn.created_by into c
      from public.rent_charges ch
      join public.rentals rn on rn.id = ch.rental_id and rn.tenant_id = ch.tenant_id
     where ch.id = v_ref and ch.tenant_id = v_tenant and rn.renter_customer_id = v_customer
       and rn.status = 'active' and ch.status in ('pending', 'overdue');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if v_amount is not null and v_amount > c.amount then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount');
    end if;
    if exists (select 1 from public.rent_payment_notices n where n.charge_id = c.id and n.status = 'pending') then
      return jsonb_build_object('ok', true, 'code', 'duplicate');
    end if;
    insert into public.rent_payment_notices (tenant_id, rental_id, charge_id, customer_id, amount, reference, note)
    values (v_tenant, c.rental_id, c.id, v_customer, coalesce(v_amount, c.amount),
            nullif(left(btrim(coalesce(p_payload ->> 'reference', '')), 120), ''), nullif(v_note, ''))
    returning id into v_id;
    select pr.assigned_to into v_user from public.properties pr where pr.id = c.property_id and pr.tenant_id = v_tenant;
    v_user := coalesce(v_user, c.created_by, v_cust_advisor);
    v_title := 'Kiracı kirayı ödediğini bildirdi';
    v_body := left(coalesce(v_cust_name, 'Kiracı') || ' · ' || to_char(c.period, 'MM.YYYY') || ' kirası · ' || to_char(coalesce(v_amount, c.amount), 'FM999G999G999G990') || ' TL'
      || case when v_note <> '' then ' · Not: ' || v_note else '' end || ' · Hesabınıza geçtiyse teyit edin.', 900);
    insert into public.tasks (tenant_id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id)
    values (v_tenant, 'Kira ödemesini teyit et', v_body, 'followup', 'high', 'open', now() + interval '1 day', v_user, v_customer, c.property_id);
    v_href := '/app/kiralama/' || c.rental_id::text;

  else
    select rn.id, rn.property_id, rn.created_by into r
      from public.rentals rn
     where rn.id = v_ref and rn.tenant_id = v_tenant and rn.renter_customer_id = v_customer and rn.status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    insert into public.maintenance_requests (tenant_id, rental_id, title, description)
    values (v_tenant, r.id, v_mtitle, nullif(left(btrim(coalesce(p_payload ->> 'description', '')), 2000), ''))
    returning id into v_id;
    select pr.assigned_to into v_user from public.properties pr where pr.id = r.property_id and pr.tenant_id = v_tenant;
    v_user := coalesce(v_user, r.created_by, v_cust_advisor);
    v_title := 'Kiracıdan bakım talebi';
    v_body := left(coalesce(v_cust_name, 'Kiracı') || ' · ' || v_mtitle, 900);
    v_href := '/app/kiralama/' || r.id::text;
  end if;

  insert into public.portal_customer_requests (tenant_id, customer_id, kind, ref_id, result_id)
  values (v_tenant, v_customer, p_kind, v_ref, v_id);
  -- Bildirim: atanmış kişiye; kimse yoksa ofis geneli (user_id null). Yazılamazsa iş kaydı yine kalır.
  begin
    insert into public.notifications (tenant_id, user_id, title, body, href, kind, meta)
    values (v_tenant, v_user, v_title, v_body, v_href, case when p_kind = 'cancel' then 'warning' else 'info' end,
            jsonb_build_object('source', 'customer_portal', 'kind', p_kind, 'ref', v_ref));
  exception when others then
    null;
  end;
  return jsonb_build_object('ok', true, 'code', 'ok', 'id', v_id);
end;
$$;

revoke all on function public.portal_customer_request(text, text, jsonb) from public;
grant execute on function public.portal_customer_request(text, text, jsonb) to anon, authenticated, service_role;

comment on table public.portal_demand_updates is 'Müşteri portalı arayış güncelleme istekleri. Yazma yalnız portal_customer_request RPC''si; talebi danışman onaylayınca günceller.';
comment on table public.rent_payment_notices is 'Kiracı "Ödedim" bildirimleri (teyit bekliyor). Tahakkuk durumu danışman teyidine kadar değişmez. Yazma yalnız portal_customer_request RPC''si.';

notify pgrst, 'reload schema';
