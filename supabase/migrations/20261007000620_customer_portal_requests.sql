-- Müşteri tek portalı: token'lı müşteri istekleri (teklif, randevu erteleme/iptal, bakım talebi) — PB51.
--
-- NEDEN: Müşteri portalı salt okunurdu; alıcı teklif veremiyor, randevuyu erteleyemiyor (yalnız iptal), kiracı arıza
--   bildiremiyordu (persona belgesi). Yeni yazma yolu service_role GEREKTİRMEZ: tek bir anon/authenticated SECURITY DEFINER
--   RPC token'ı içeride doğrular ve yalnız O KİŞİNİN kayıtlarına bağlı satır yazar.
-- RPC portal_customer_request(p_token, p_kind, p_payload) → {ok, code[, id]}:
--   - Token: customer_portal_tokens (süresi geçmemiş) + ofis public-aktif (active|trial|past_due) + müşteri örnek/silinmiş değil.
--   - 'offer'      {property_id, amount, note?}   : portföy aynı ofiste, örnek/silinmiş değil, yayında (live|reserved|Yayında).
--                   offers satırı 'draft' (danışman inceler; malik portalı taslakları göstermez), not offers'a YAZILMAZ
--                   (alıcının notu malike gitmesin) → yalnız danışman bildirimine.
--   - 'reschedule' / 'cancel' {appointment_id, preferred?, note?} : randevu bu müşterinin, iptal/tamam değil, geçmemiş →
--                   danışmana GÖREV (yüksek öncelik) + bildirim. Randevunun kendisi DEĞİŞMEZ (karar danışmanda).
--   - 'maintenance' {rental_id, title, description?} : kira kaydı bu müşterinin (kiracı) ve aktif → maintenance_requests + bildirim.
--   Frenler: müşteri başına 24 saatte en çok 10 istek; aynı tür + aynı kayıt 10 dakika içinde tekrar yazılmaz.
--   Her istek portal_customer_requests'e (denetim izi) yazılır; ofis okur, kimse doğrudan yazamaz.
-- BAGIMLILIK: customer_portal_tokens (20260723000030), offers/offer_status (20260723000031), tasks (20260722000022),
--   rentals/maintenance_requests (20260726000074), notifications (20260722000007), customers.is_sample (20260816001600).
-- GERI ALMA: rollbacks/20261007000620_customer_portal_requests.rollback.sql (RPC + iz tablosu düşer; yazılmış teklif/görev/
--   bakım kayıtları KALIR — iş kaydıdırlar).
-- RISK: düşük-orta (anon'a açık yazma RPC'si; token 64 hex, frenli, yalnız taslak/görev/bakım yazar, mevcut kayıt değiştirmez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.customer_portal_tokens') is null
     or pg_catalog.to_regclass('public.offers') is null
     or pg_catalog.to_regclass('public.tasks') is null
     or pg_catalog.to_regclass('public.maintenance_requests') is null
     or pg_catalog.to_regclass('public.notifications') is null then
    raise exception 'customer_portal_tokens/offers/tasks/maintenance_requests/notifications yok.';
  end if;
end $$;

create table if not exists public.portal_customer_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind        text not null check (kind in ('offer', 'reschedule', 'cancel', 'maintenance')),
  ref_id      uuid not null,
  result_id   uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_portal_customer_requests_customer on public.portal_customer_requests (customer_id, created_at desc);
create index if not exists idx_portal_customer_requests_tenant on public.portal_customer_requests (tenant_id, created_at desc);

alter table public.portal_customer_requests enable row level security;
drop policy if exists portal_customer_requests_select on public.portal_customer_requests;
create policy portal_customer_requests_select on public.portal_customer_requests for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'view')));
revoke all on table public.portal_customer_requests from public, anon;
grant select on table public.portal_customer_requests to authenticated;
grant all on table public.portal_customer_requests to service_role;

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
  v_amount numeric;
  v_mtitle text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  if p_kind not in ('offer', 'reschedule', 'cancel', 'maintenance') or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select cpt.tenant_id, cpt.customer_id into v_tenant, v_customer
    from public.customer_portal_tokens cpt
    join public.tenants tn on tn.id = cpt.tenant_id
   where cpt.token = p_token and cpt.expires_at > now() and tn.status in ('active', 'trial', 'past_due');
  if v_customer is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  select c.full_name, c.assigned_to into v_cust_name, v_cust_advisor
    from public.customers c
   where c.id = v_customer and c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;

  begin
    v_ref := nullif(coalesce(p_payload ->> 'property_id', p_payload ->> 'appointment_id', p_payload ->> 'rental_id'), '')::uuid;
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

create or replace function public.portal_customer_request_ready()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;
revoke all on function public.portal_customer_request_ready() from public;
grant execute on function public.portal_customer_request_ready() to anon, authenticated, service_role;

comment on function public.portal_customer_request(text, text, jsonb) is 'Müşteri portalı yazma kapısı: token içeride doğrulanır; yalnız o müşterinin randevusu/kira kaydı ya da yayındaki portföy için taslak teklif, görev veya bakım talebi yazar.';
comment on table public.portal_customer_requests is 'Müşteri portalı istek izi (fren + denetim). Yazma yalnız portal_customer_request RPC''si.';

notify pgrst, 'reload schema';
