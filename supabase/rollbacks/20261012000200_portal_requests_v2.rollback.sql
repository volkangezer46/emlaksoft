-- Rollback: 20261012000200_portal_requests_v2
-- portal_customer_request önceki gövdesine (20261007000620) döner; yeni tablolar ve sütun düşer.
-- Bekleyen arayış güncelleme istekleri ve "Ödedim" bildirimleri SİLİNİR (iş kaydı değil, istek izidir); görevler/bildirimler kalır.
-- Portföy bazlı haftalık rapor anahtarı kalkar; haftalık rapor yalnız ofis ayarına uyar.

set local lock_timeout = '5s';

delete from public.portal_customer_requests where kind in ('visit', 'demand_update', 'rent_paid');
alter table public.portal_customer_requests drop constraint if exists portal_customer_requests_kind_check;
alter table public.portal_customer_requests add constraint portal_customer_requests_kind_check
  check (kind in ('offer', 'reschedule', 'cancel', 'maintenance'));

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

drop table if exists public.rent_payment_notices;
drop table if exists public.portal_demand_updates;
alter table public.owner_portal_tokens drop column if exists weekly_report_enabled;

notify pgrst, 'reload schema';
