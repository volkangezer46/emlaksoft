-- Giden webhook kuyrugu: dogrudan RPC ile olay yazma acigi kapatilir (PB51).
--
-- SORUN (20261007000320): webhook_enqueue / webhook_mark_delivery authenticated'a acik DEFINER RPC'lerdi. Ofisin HER uyesi
--   (salt okunur dahil) PostgREST'ten dogrudan cagirarak (a) yetkisi olmadigi kaydin olayini uretip ofisin uclarina
--   kayit verisini gonderebiliyor ve kuyrugu 1000 bekleyene kadar doldurabiliyor, (b) herhangi bir bekleyen teslimi
--   "teslim edildi/basarisiz" isaretleyerek yeniden denemeyi bozabiliyordu.
-- COZUM (yalniz CREATE OR REPLACE + ek sutun; tablo/politika degismez):
--   1. webhook_enqueue: olay turune gore MODUL izni sart (customer -> customers, property -> properties, deal -> commissions;
--      *.created -> 'create', *.updated -> 'edit'; has_effective_permission). Ayni kayit+olay icin 30 sn icinde ikinci
--      kuyruk satiri yazilmaz (dongu/spam freni). Kuyruk satiri cagirani `enqueued_by` olarak tasir.
--   2. webhook_mark_delivery: yalniz satiri KUYRUGA YAZAN kullanici, yalniz ILK deneme (attempts = 0) ve yalniz 10 dk icinde
--      isaretleyebilir. Sonraki denemeler yalniz service_role (cron) ile yapilir.
-- Uygulama tarafi degismedi: server action'lar zaten requirePermission sonrasinda ayni kullanicinin oturumuyla cagirir.
-- BAGIMLILIK: 20261007000320_webhooks_api_keys (tablolar + fonksiyonlar), has_effective_permission(text,text).
-- GERI ALMA: rollbacks/20261007000600_webhook_enqueue_gate.rollback.sql (000320 govdeleri birebir + sutun dusurulur).
-- RISK: dusuk (yalniz sikilasir; izinsiz cagri sessizce bos doner — mevcut "kanal kapali" davranisi ile ayni).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.webhook_deliveries') is null
     or pg_catalog.to_regprocedure('public.webhook_enqueue(text, text, uuid)') is null
     or pg_catalog.to_regprocedure('public.webhook_mark_delivery(uuid, boolean, integer, text)') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception '20261007000320 (webhook tablolari/RPC) veya has_effective_permission yok; once onu uygulayin.';
  end if;
end $$;

alter table public.webhook_deliveries add column if not exists enqueued_by uuid;
comment on column public.webhook_deliveries.enqueued_by is 'Kuyruga yazan kullanici (auth.uid()); ilk teslim isaretini yalniz o yapabilir. Cron satirlari icin anlam tasimaz.';

-- ------------------------------------------------------------------ webhook_enqueue (izin kapili)
create or replace function public.webhook_enqueue(p_event text, p_entity_type text, p_entity_id uuid)
returns table (delivery_id uuid, endpoint_id uuid, url text, secret_version integer, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_pending integer;
  v_data jsonb;
  v_body jsonb;
  v_module text;
  v_action text;
begin
  if v_uid is null or v_tenant is null then
    return;
  end if;
  if p_event not in ('customer.created', 'customer.updated', 'property.created', 'property.updated', 'deal.created', 'deal.updated') then
    raise exception 'gecersiz olay' using errcode = '22023';
  end if;
  if p_entity_type not in ('customer', 'property', 'deal') then
    raise exception 'gecersiz varlik' using errcode = '22023';
  end if;
  -- Olay turu varlikla tutarli olmali (customer.* yalniz customer vb.).
  if split_part(p_event, '.', 1) <> p_entity_type then
    raise exception 'olay ve varlik uyusmuyor' using errcode = '22023';
  end if;
  -- MODUL IZNI: olayi yalniz o kaydi olusturma/duzenleme yetkisi olan kullanici uretebilir (server action kapisiyla ayni).
  v_module := case p_entity_type when 'customer' then 'customers' when 'property' then 'properties' else 'commissions' end;
  v_action := case when p_event like '%.created' then 'create' else 'edit' end;
  if not public.has_effective_permission(v_module, v_action) then
    return;
  end if;
  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = v_tenant and e.active and p_event = any (e.events)) then
    return;
  end if;
  select count(*) into v_pending from public.webhook_deliveries d where d.tenant_id = v_tenant and d.status = 'pending';
  if v_pending >= 1000 then
    return;
  end if;
  -- Dongu/spam freni: ayni kayit + olay 30 sn icinde zaten kuyruga yazildiysa yeniden yazilmaz.
  if exists (
    select 1 from public.webhook_deliveries d
     where d.tenant_id = v_tenant and d.event = p_event and d.created_at > now() - interval '30 seconds'
       and d.payload -> 'entity' ->> 'id' = p_entity_id::text
  ) then
    return;
  end if;
  -- Veri TEK KAYNAKTAN (api_v1_list ile ayni alanlar), ofis + ornek veri suzgeciyle; ornek kayit olay URETMEZ.
  if p_entity_type = 'customer' then
    select to_jsonb(r) into v_data from (
      select c.id, c.full_name, c.phone, c.email, c.source, c.customer_types, c.created_at
        from public.customers c where c.id = p_entity_id and c.tenant_id = v_tenant and c.is_sample = false
    ) r;
  elsif p_entity_type = 'property' then
    select to_jsonb(r) into v_data from (
      select p.id, p.property_code, p.title, p.status, p.transaction_type, p.property_type, p.list_price,
             p.features->>'rooms' as rooms, p.features->>'sqm' as sqm, p.province_id, p.district_id, p.created_at, p.updated_at
        from public.properties p where p.id = p_entity_id and p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null
    ) r;
  else
    select to_jsonb(r) into v_data from (
      select d.id, d.deal_type, d.stage, d.deal_value, d.property_id, d.customer_id, d.created_at, d.updated_at
        from public.deals d where d.id = p_entity_id and d.tenant_id = v_tenant and d.is_sample = false
    ) r;
  end if;
  if v_data is null then
    return;
  end if;
  v_body := jsonb_build_object(
    'event', p_event,
    'occurred_at', now(),
    'tenant_id', v_tenant,
    'entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id),
    'data', v_data
  );
  return query
    insert into public.webhook_deliveries as d (tenant_id, endpoint_id, event, payload, enqueued_by)
    select v_tenant, e.id, p_event, v_body, v_uid
    from public.webhook_endpoints e
    where e.tenant_id = v_tenant and e.active and p_event = any (e.events)
    returning d.id, d.endpoint_id,
      (select e2.url from public.webhook_endpoints e2 where e2.id = d.endpoint_id),
      (select e2.secret_version from public.webhook_endpoints e2 where e2.id = d.endpoint_id),
      d.payload;
end;
$$;

-- ------------------------------------------------------------------ webhook_mark_delivery (yalniz kuyruga yazan, ilk deneme)
create or replace function public.webhook_mark_delivery(p_id uuid, p_ok boolean, p_status integer, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_endpoint uuid;
  v_attempts integer;
begin
  if v_uid is null or v_tenant is null then
    return;
  end if;
  update public.webhook_deliveries d
     set attempts = d.attempts + 1,
         status = case when p_ok then 'delivered' when d.attempts + 1 >= 6 then 'failed' else 'pending' end,
         delivered_at = case when p_ok then now() else null end,
         next_attempt_at = now() + make_interval(mins => least(720, (power(2, d.attempts + 1) * 5)::int)),
         last_status_code = p_status,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 300) end
   where d.id = p_id and d.tenant_id = v_tenant and d.status = 'pending'
     and d.enqueued_by = v_uid and d.attempts = 0 and d.created_at > now() - interval '10 minutes'
   returning d.endpoint_id, d.attempts into v_endpoint, v_attempts;
  if v_endpoint is not null then
    update public.webhook_endpoints e
       set last_status = p_status,
           last_delivery_at = now(),
           failure_count = case when p_ok then 0 else e.failure_count + 1 end
     where e.id = v_endpoint and e.tenant_id = v_tenant;
  end if;
end;
$$;

revoke all on function public.webhook_enqueue(text, text, uuid) from public, anon;
revoke all on function public.webhook_mark_delivery(uuid, boolean, integer, text) from public, anon;
grant execute on function public.webhook_enqueue(text, text, uuid) to authenticated, service_role;
grant execute on function public.webhook_mark_delivery(uuid, boolean, integer, text) to authenticated, service_role;

notify pgrst, 'reload schema';
