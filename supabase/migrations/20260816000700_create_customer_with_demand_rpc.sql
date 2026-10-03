-- Faz 2 / 07: create_customer_with_demand — müşteri + (ops.) ilk talep tek işlemde.
--
-- NEDEN: bugün müşteri ve talep iki ayrı istekte oluşuyor; ikincisi düşerse müşteri talepsiz kalıyor.
-- TASARIM:
--   * SECURITY INVOKER: çağıranın RLS'i işler; tenant sınırı ve izinler (customers:create, demands:create)
--     politikalarda zaten uygulanır. Fonksiyon ek olarak AÇIK kontrol yapar ve anlamlı hata verir.
--   * Tenant kontrolü: p_tenant_id, JWT tenant'ı (current_tenant_id) ile eşleşmezse 42501.
--     (assert_current_tenant yalnız SECURITY DEFINER çağıranlara açık olduğundan burada kullanılmaz.)
--   * Tek işlem: iki INSERT aynı fonksiyon çağrısında; biri hata verirse ikisi de geri alınır.
--   * Telefon: doğrulama/normalizasyon (parsePhone) sunucuda YAPILIR, buraya normalize değer gelir;
--     customers_phone_* CHECK ve plan kapasitesi trigger'ı (trg_customers_plan_capacity) yine devrede.
--   * assigned_to boşsa çağıran (auth.uid()); verilirse bileşik FK aynı tenant'tan olmasını zorlar.
--   * p_demand (jsonb) null ise yalnız müşteri oluşur. Anahtarlar: transaction_type (zorunlu), property_type,
--     province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, max_sqm, urgency,
--     currency, budget_includes_loan, swap_ok, floor_min, floor_max, max_building_age, required_keys (dizi),
--     criteria (nesne). Sütunlar 06 numaralı migration'dan gelir.
-- BAĞIMLILIK: 06.
-- GERİ ALMA: rollbacks/20260816000700_create_customer_with_demand_rpc.rollback.sql (fonksiyonu düşürür;
--   veri değişmez, kod eski iki adımlı akışa dönmelidir).
-- RİSK: düşük (yeni fonksiyon, anon/public erişimi kapalı).

create or replace function public.create_customer_with_demand(
  p_tenant_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_customer_types text[] default '{}',
  p_province_id uuid default null,
  p_district_id uuid default null,
  p_branch_id uuid default null,
  p_notes text default null,
  p_assigned_to uuid default null,
  p_source text default null,
  p_demand jsonb default null
)
returns table(customer_id uuid, demand_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_user uuid := auth.uid();
  v_customer uuid;
  v_demand uuid;
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
begin
  if v_tenant is null or v_user is null or p_tenant_id is distinct from v_tenant then
    raise exception 'Tenant scope mismatch.' using errcode = '42501';
  end if;
  if not public.has_effective_permission('customers', 'create') then
    raise exception 'Musteri olusturma yetkisi yok.' using errcode = '42501';
  end if;
  if p_demand is not null and not public.has_effective_permission('demands', 'create') then
    raise exception 'Talep olusturma yetkisi yok.' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'Gecersiz musteri adi.' using errcode = '22023';
  end if;
  if p_demand is not null then
    if jsonb_typeof(p_demand) <> 'object' then
      raise exception 'Talep nesne olmali.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_demand ->> 'transaction_type', '')), '') is null then
      raise exception 'Talepte islem turu zorunlu.' using errcode = '22023';
    end if;
  end if;

  insert into public.customers (
    tenant_id, full_name, phone, email, customer_types,
    province_id, district_id, branch_id, notes, source,
    assigned_to, created_by
  ) values (
    v_tenant, v_name, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
    coalesce(p_customer_types, '{}'),
    p_province_id, p_district_id, p_branch_id, p_notes, p_source,
    coalesce(p_assigned_to, v_user), v_user
  )
  returning id into v_customer;

  if p_demand is not null then
    insert into public.customer_demands (
      tenant_id, customer_id, transaction_type, property_type,
      province_id, district_id, neighborhood_id,
      budget_min, budget_max, rooms, min_sqm, max_sqm, urgency,
      currency, budget_includes_loan, swap_ok,
      floor_min, floor_max, max_building_age, required_keys,
      criteria, status
    ) values (
      v_tenant, v_customer,
      btrim(p_demand ->> 'transaction_type'),
      nullif(p_demand ->> 'property_type', ''),
      nullif(p_demand ->> 'province_id', '')::uuid,
      nullif(p_demand ->> 'district_id', '')::uuid,
      nullif(p_demand ->> 'neighborhood_id', '')::uuid,
      nullif(p_demand ->> 'budget_min', '')::numeric,
      nullif(p_demand ->> 'budget_max', '')::numeric,
      nullif(p_demand ->> 'rooms', ''),
      nullif(p_demand ->> 'min_sqm', '')::numeric,
      nullif(p_demand ->> 'max_sqm', '')::numeric,
      nullif(p_demand ->> 'urgency', ''),
      coalesce(nullif(p_demand ->> 'currency', ''), 'TRY'),
      nullif(p_demand ->> 'budget_includes_loan', '')::boolean,
      nullif(p_demand ->> 'swap_ok', '')::boolean,
      nullif(p_demand ->> 'floor_min', '')::integer,
      nullif(p_demand ->> 'floor_max', '')::integer,
      nullif(p_demand ->> 'max_building_age', '')::integer,
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(
          case when jsonb_typeof(p_demand -> 'required_keys') = 'array' then p_demand -> 'required_keys' else '[]'::jsonb end
        ) as t(value)),
        '{}'
      ),
      case when jsonb_typeof(p_demand -> 'criteria') = 'object' then p_demand -> 'criteria' else '{}'::jsonb end,
      'active'
    )
    returning id into v_demand;
  end if;

  return query select v_customer, v_demand;
end;
$$;

comment on function public.create_customer_with_demand(
  uuid, text, text, text, text[], uuid, uuid, uuid, text, uuid, text, jsonb
) is
  'Musteri + ilk talep tek islemde (SECURITY INVOKER, RLS ve tenant kontrolu). Telefon sunucuda normalize edilmis gelir.';

revoke all on function public.create_customer_with_demand(
  uuid, text, text, text, text[], uuid, uuid, uuid, text, uuid, text, jsonb
) from public, anon;
grant execute on function public.create_customer_with_demand(
  uuid, text, text, text, text[], uuid, uuid, uuid, text, uuid, text, jsonb
) to authenticated;
