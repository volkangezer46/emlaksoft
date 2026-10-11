-- Kiracı "Ödedim" dekont fotoğrafı (portal v2): özel kova + bildirim üzerinde dekont meta sütunları + token çözen RPC.
-- BAĞIMLILIK: 20261012000200_portal_requests_v2.sql (rent_payment_notices, customer_portal_tokens).
-- Güvenlik: kova ÖZEL (public=false), 5 MB, yalnız jpeg/png/pdf. Nesneyi yalnız sunucu (service_role) imzalı yükleme URL'siyle yazar;
-- istemci kovaya doğrudan erişemez (storage.objects için anon/authenticated politikası EKLENMEZ). Dosya baytları sunucuda doğrulanır
-- (receipt_status 'verified' olmadan danışmana gösterilmez). Yol: <ofis>/<kiracı müşteri>/<bildirim>/<dosya>.<uzantı>.

do $$
begin
  if pg_catalog.to_regclass('public.rent_payment_notices') is null
     or pg_catalog.to_regclass('public.customer_portal_tokens') is null then
    raise exception '20261012000800: taban sema eksik (rent_payment_notices / customer_portal_tokens).';
  end if;
end $$;

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('rent-receipts', 'rent-receipts', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf']::text[])
    on conflict (id) do update
      set public = false,
          file_size_limit = 5242880,
          allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']::text[];
  end if;
end $$;

alter table public.rent_payment_notices
  add column if not exists receipt_path text,
  add column if not exists receipt_name text,
  add column if not exists receipt_mime text,
  add column if not exists receipt_size integer,
  add column if not exists receipt_status text,
  add column if not exists receipt_prepared_at timestamptz;

alter table public.rent_payment_notices drop constraint if exists rent_payment_notices_receipt_check;
alter table public.rent_payment_notices
  add constraint rent_payment_notices_receipt_check check (
    (receipt_status is null and receipt_path is null)
    or (
      receipt_status in ('pending', 'verified', 'blocked')
      and receipt_path is not null
      and receipt_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'
      and receipt_mime in ('image/jpeg', 'image/png', 'application/pdf')
      and receipt_size between 1 and 5242880
      and char_length(coalesce(receipt_name, '')) between 1 and 255
    )
  );

-- Token çözümü (oturumsuz): yalnız bu müşterinin bekleyen "Ödedim" bildirimi döner. Ofis/müşteri sunucuya yalnız buradan gelir.
create or replace function public.portal_rent_receipt_target(p_token text, p_charge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  n record;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32,128}$' or p_charge_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  select cpt.tenant_id, cpt.customer_id into v_tenant, v_customer
    from public.customer_portal_tokens cpt
    join public.tenants tn on tn.id = cpt.tenant_id
   where cpt.token = p_token and cpt.expires_at > now() and tn.status in ('active', 'trial', 'past_due');
  if v_customer is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  if not exists (
    select 1 from public.customers cu
     where cu.id = v_customer and cu.tenant_id = v_tenant and cu.is_sample = false and cu.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;
  select nt.id, nt.receipt_status into n
    from public.rent_payment_notices nt
   where nt.charge_id = p_charge_id and nt.tenant_id = v_tenant and nt.customer_id = v_customer and nt.status = 'pending'
   order by nt.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'tenant_id', v_tenant, 'customer_id', v_customer, 'notice_id', n.id, 'receipt_status', n.receipt_status);
end;
$$;

revoke all on function public.portal_rent_receipt_target(text, uuid) from public;
grant execute on function public.portal_rent_receipt_target(text, uuid) to anon, authenticated, service_role;

comment on column public.rent_payment_notices.receipt_path is 'Dekont nesnesi (rent-receipts kovası, özel). Yazma yalnız sunucu (service_role); danışman imzalı kısa ömürlü URL ile görür.';
