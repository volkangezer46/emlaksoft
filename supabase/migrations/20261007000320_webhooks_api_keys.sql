-- Giden webhook + basit acik API anahtari (ofis entegrasyonlari).
--
-- TABLOLAR:
--   api_keys            : ofis API anahtarlari. Anahtarin KENDISI SAKLANMAZ: yalniz sha256 ozeti (key_hash) + gorunur on ek.
--                         scopes = okunabilir kaynaklar ('properties' | 'customers' | 'deals'). Iptal = revoked_at.
--   webhook_endpoints   : ofis webhook hedefleri (yalniz https), abone olunan olaylar, imza surumu (sir SAKLANMAZ:
--                         sunucu sirrindan uc kimligi + surumle turetilir; WEBHOOK_SIGNING_SECRET yoksa kanal kapali).
--   webhook_deliveries  : teslim kuyrugu (pending -> delivered | failed), deneme sayaci ve geri cekilme.
-- RPC:
--   webhook_enqueue(event, entity_type, entity_id)           [authenticated, DEFINER] — kimlik auth.uid() + current_tenant_id();
--      veriyi kayittan kendisi okur (ornek kayit olay uretmez), aktif/abone uclar icin kuyruga yazar, ani teslim icin
--      satirlari dondurur. Bekleyen tavan 1000/ofis.
--   webhook_mark_delivery(id, ok, status, error)              [authenticated, DEFINER] — yalniz kendi ofisinin bekleyen satiri.
--   api_v1_list(key_hash, resource, limit, before)            [anon+authenticated, DEFINER] — anahtar dogrulama + salt okunur liste
--      (ornek veri ve silinmis kayit HARIC; en cok 100 satir; created_at < before ile sayfalama). last_used_at gunceller.
-- RLS: uc tablo icin okuma/yazma ayni ofis + has_effective_permission('settings','edit') (owner/gm varsayilan).
--   webhook_deliveries'e authenticated INSERT/UPDATE yok (yalniz RPC); cron service_role ile yeniden dener.
-- BAGIMLILIK: current_tenant_id(), has_effective_permission(text,text), customers/properties/deals.
-- GERI ALMA: rollbacks/20261007000320_webhooks_api_keys.rollback.sql (anahtarlar, uclar ve kuyruk silinir).
-- RISK: dusuk-orta (yeni tablolar + anon'a acik tek okuma RPC'si; anahtar ozeti olmadan hicbir satir donmez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception 'current_tenant_id()/has_effective_permission(text,text) yok.';
  end if;
end $$;

-- ------------------------------------------------------------------ api_keys
create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  key_prefix    text not null check (key_prefix ~ '^es_[a-z0-9]{8}$'),
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes        text[] not null default array['properties']::text[]
                check (scopes <@ array['properties', 'customers', 'deals']::text[] and cardinality(scopes) between 1 and 3),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists idx_api_keys_tenant on public.api_keys (tenant_id, created_at desc);

-- ------------------------------------------------------------------ webhook_endpoints
create table if not exists public.webhook_endpoints (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  url              text not null check (url ~ '^https://[^\s/?#@]+\.[^\s/?#@]+(/[^\s]*)?$' and char_length(url) <= 500),
  events           text[] not null
                   check (events <@ array['customer.created', 'customer.updated', 'property.created', 'property.updated', 'deal.created', 'deal.updated']::text[]
                          and cardinality(events) between 1 and 6),
  active           boolean not null default true,
  secret_version   integer not null default 1 check (secret_version between 1 and 1000),
  failure_count    integer not null default 0,
  last_status      integer,
  last_delivery_at timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_webhook_endpoints_tenant on public.webhook_endpoints (tenant_id) where active;

-- ------------------------------------------------------------------ webhook_deliveries
create table if not exists public.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  endpoint_id      uuid not null references public.webhook_endpoints(id) on delete cascade,
  event            text not null check (char_length(event) <= 40),
  payload          jsonb not null check (pg_column_size(payload) <= 16384),
  status           text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts         integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at  timestamptz not null default now(),
  last_status_code integer,
  last_error       text check (last_error is null or char_length(last_error) <= 300),
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);
create index if not exists idx_webhook_deliveries_pending on public.webhook_deliveries (next_attempt_at) where status = 'pending';
create index if not exists idx_webhook_deliveries_tenant on public.webhook_deliveries (tenant_id, created_at desc);

alter table public.api_keys enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

-- Okuma ve yazma: ayni ofis + ayarlar:edit (anahtar ozeti/uc listesi yonetim verisidir).
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')) and created_by = (select auth.uid()));
drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists webhook_endpoints_insert on public.webhook_endpoints;
create policy webhook_endpoints_insert on public.webhook_endpoints for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')) and created_by = (select auth.uid()));
drop policy if exists webhook_endpoints_update on public.webhook_endpoints;
create policy webhook_endpoints_update on public.webhook_endpoints for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists webhook_endpoints_delete on public.webhook_endpoints;
create policy webhook_endpoints_delete on public.webhook_endpoints for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

revoke all on table public.api_keys from public, anon;
revoke all on table public.webhook_endpoints from public, anon;
revoke all on table public.webhook_deliveries from public, anon;
grant select, insert, update on table public.api_keys to authenticated;
grant select, insert, update, delete on table public.webhook_endpoints to authenticated;
grant select on table public.webhook_deliveries to authenticated;
grant all on table public.api_keys to service_role;
grant all on table public.webhook_endpoints to service_role;
grant all on table public.webhook_deliveries to service_role;

-- ------------------------------------------------------------------ webhook_enqueue
create or replace function public.webhook_enqueue(p_event text, p_entity_type text, p_entity_id uuid)
returns table (delivery_id uuid, endpoint_id uuid, url text, secret_version integer, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_pending integer;
  v_data jsonb;
  v_body jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    return;
  end if;
  if p_event not in ('customer.created', 'customer.updated', 'property.created', 'property.updated', 'deal.created', 'deal.updated') then
    raise exception 'gecersiz olay' using errcode = '22023';
  end if;
  if p_entity_type not in ('customer', 'property', 'deal') then
    raise exception 'gecersiz varlik' using errcode = '22023';
  end if;
  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = v_tenant and e.active and p_event = any (e.events)) then
    return;
  end if;
  select count(*) into v_pending from public.webhook_deliveries d where d.tenant_id = v_tenant and d.status = 'pending';
  if v_pending >= 1000 then
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
    insert into public.webhook_deliveries as d (tenant_id, endpoint_id, event, payload)
    select v_tenant, e.id, p_event, v_body
    from public.webhook_endpoints e
    where e.tenant_id = v_tenant and e.active and p_event = any (e.events)
    returning d.id, d.endpoint_id,
      (select e2.url from public.webhook_endpoints e2 where e2.id = d.endpoint_id),
      (select e2.secret_version from public.webhook_endpoints e2 where e2.id = d.endpoint_id),
      d.payload;
end;
$$;

-- ------------------------------------------------------------------ webhook_mark_delivery
create or replace function public.webhook_mark_delivery(p_id uuid, p_ok boolean, p_status integer, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_endpoint uuid;
  v_attempts integer;
begin
  if auth.uid() is null or v_tenant is null then
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

-- ------------------------------------------------------------------ api_v1_list (anon)
create or replace function public.api_v1_list(p_key_hash text, p_resource text, p_limit integer default 50, p_before timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key record;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_rows jsonb;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  select k.id, k.tenant_id, k.scopes into v_key
    from public.api_keys k
    join public.tenants t on t.id = k.tenant_id
   where k.key_hash = p_key_hash and k.revoked_at is null and t.status in ('active', 'trial', 'past_due');
  if v_key.id is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  if not (p_resource = any (v_key.scopes)) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  update public.api_keys set last_used_at = now() where id = v_key.id and (last_used_at is null or last_used_at < now() - interval '1 minute');

  if p_resource = 'properties' then
    select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) into v_rows from (
      select p.id, p.property_code, p.title, p.status, p.transaction_type, p.property_type, p.list_price,
             p.features->>'rooms' as rooms, p.features->>'sqm' as sqm, p.province_id, p.district_id, p.created_at, p.updated_at
        from public.properties p
       where p.tenant_id = v_key.tenant_id and p.deleted_at is null and p.is_sample = false and p.created_at < v_before
       order by p.created_at desc
       limit v_limit
    ) r;
  elsif p_resource = 'customers' then
    select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) into v_rows from (
      select c.id, c.full_name, c.phone, c.email, c.source, c.customer_types, c.created_at
        from public.customers c
       where c.tenant_id = v_key.tenant_id and c.deleted_at is null and c.is_sample = false and c.created_at < v_before
       order by c.created_at desc
       limit v_limit
    ) r;
  elsif p_resource = 'deals' then
    select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) into v_rows from (
      select d.id, d.deal_type, d.stage, d.deal_value, d.property_id, d.customer_id, d.created_at, d.updated_at
        from public.deals d
       where d.tenant_id = v_key.tenant_id and d.is_sample = false and d.created_at < v_before
       order by d.created_at desc
       limit v_limit
    ) r;
  else
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'data', v_rows);
end;
$$;

revoke all on function public.webhook_enqueue(text, text, uuid) from public, anon;
revoke all on function public.webhook_mark_delivery(uuid, boolean, integer, text) from public, anon;
revoke all on function public.api_v1_list(text, text, integer, timestamptz) from public;
grant execute on function public.webhook_enqueue(text, text, uuid) to authenticated, service_role;
grant execute on function public.webhook_mark_delivery(uuid, boolean, integer, text) to authenticated, service_role;
grant execute on function public.api_v1_list(text, text, integer, timestamptz) to anon, authenticated, service_role;

comment on table public.api_keys is 'Ofis API anahtarlari: yalniz sha256 ozeti saklanir; scopes okunabilir kaynaklar.';
comment on table public.webhook_endpoints is 'Ofis webhook hedefleri (https). Imza sirri saklanmaz; sunucu sirrindan turetilir.';
comment on table public.webhook_deliveries is 'Webhook teslim kuyrugu (pending/delivered/failed), 6 denemede failed.';

notify pgrst, 'reload schema';
