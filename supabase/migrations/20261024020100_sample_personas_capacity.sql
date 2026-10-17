-- MIGRATION 20261024020100_sample_personas_capacity.sql
-- UYGULANMADI: 20261024020000_demo_mode_lock_purge_v2 SONRASI, ayni pencerede uygulanir.
-- Geri alma: supabase/rollbacks/20261024020100_sample_personas_capacity.rollback.sql (iki fonksiyon 20261013004000 govdesine doner).
-- BAGIMLILIK: profiles.is_sample (20261024020000) ve iki kapasite fonksiyonunun SON govdesi (20261013004000).
--
-- AMAC: ornek veri ile acilan demo ekip uyeleri (profiles.is_sample = true, giris yapamaz) koltuk sayilmaz. Tek koltuklu
--   (Solo) ofis de dolu bir ekiple demo gorebilir; gercek kullanici davet edilirken demo ekip koltuk yemez; paket dusurmede
--   demo ekip engel olmaz. Gercek kullaniciya iliskin kural BIREBIR aynidir.
-- NE: enforce_plan_capacity ve enforce_tenant_plan_capacity govdeleri 20261013004000'den AYNEN kopyalandi; YALNIZ
--   (a) is_sample profilin eklenmesi/etkinlesmesi kontrol edilmez, (b) koltuk sayimi `is_sample = false` suzer.
--   Isaretler korunur: seat-capacity:v1, entitlement-override:v1 (seat_purchase_ready govdede arar). Yeni isaret sample-seat:v1.
-- ETKI: yalniz fonksiyon govdesi (create or replace); tetikleyici/tablo degismez. Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.profiles'::regclass and a.attname = 'is_sample' and not a.attisdropped
  ) then
    raise exception '20261024020100: profiles.is_sample yok; once 20261024020000 uygulanmali.';
  end if;
end $$;

create or replace function public.enforce_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant uuid;
  metric text;
  capacity integer;
  current_usage bigint;
  should_check boolean := false;
  v_effective integer;
begin
  target_tenant := new.tenant_id;

  case tg_table_name
    when 'profiles' then
      metric := 'seats';
      -- sample-seat:v1 (20261024020100): ornek (demo) ekip profili koltuk sayilmaz ve kontrol edilmez.
      should_check := new.is_active and new.is_sample is not true and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    when 'customers' then
      metric := 'customers';
      should_check := new.deleted_at is null and (
        tg_op = 'INSERT' or old.deleted_at is not null or new.tenant_id is distinct from old.tenant_id
      );
    when 'properties' then
      metric := 'active_properties';
      should_check := new.deleted_at is null
        and new.status in ('draft', 'live', 'reserved')
        and (
          tg_op = 'INSERT'
          or old.deleted_at is not null
          or old.status not in ('draft', 'live', 'reserved')
          or new.tenant_id is distinct from old.tenant_id
      );
    when 'branches' then
      metric := 'branches';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    else
      return new;
  end case;

  if not should_check then
    return new;
  end if;

  -- Serialize every capacity-changing operation for the tenant. A tenant-wide
  -- lock also makes concurrent plan downgrades and inserts observe one another.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || target_tenant::text, 0)
  );

  select case metric
    when 'seats' then pe.seat_limit
    when 'customers' then pe.customer_limit
    when 'active_properties' then pe.active_property_limit
    when 'branches' then pe.branch_limit
  end
  into capacity
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  where t.id = target_tenant;

  -- entitlement-override:v1 (20261013004000): ofise ozel limit istisnasi (tenant_entitlement_overrides) plan
  -- limitine eklenir; suresi dolan ya da geri alinan istisna sayilmaz (bitis aninda eski limit kendiliginden doner).
  -- Sinirsiz (NULL) limit sinirsiz kalir. Cozucu yoksa eski davranis aynen korunur.
  if capacity is not null
    and pg_catalog.to_regprocedure('public.tenant_entitlement_resolve(uuid,text,integer)') is not null then
    capacity := public.tenant_entitlement_resolve(target_tenant, metric, capacity);
  end if;

  -- seat-capacity:v1 (20261005000900): koltuk limiti = plan limiti + satin alinmis ek kullanici
  -- (public.effective_seat_limit, 20261005000800). Fonksiyon yoksa ya da NULL donerse eski davranis
  -- (yalniz plan limiti) aynen korunur; etkin limit plan limitinin ALTINA hicbir kosulda inmez.
  if metric = 'seats'
    and capacity is not null
    and pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is not null then
    v_effective := public.effective_seat_limit(target_tenant);
    if v_effective is not null and v_effective > capacity then
      capacity := v_effective;
    end if;
  end if;

  if capacity is null then
    return new;
  end if;

  case metric
    when 'seats' then
      select count(*) into current_usage from public.profiles
      where tenant_id = target_tenant and is_active = true and is_sample = false;
    when 'customers' then
      select count(*) into current_usage from public.customers
      where tenant_id = target_tenant and deleted_at is null;
    when 'active_properties' then
      select count(*) into current_usage from public.properties
      where tenant_id = target_tenant
        and deleted_at is null
        and status in ('draft', 'live', 'reserved');
    when 'branches' then
      select count(*) into current_usage from public.branches
      where tenant_id = target_tenant and is_active = true;
  end case;

  if current_usage >= capacity then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_LIMIT_EXCEEDED:' || metric || ':' || capacity::text;
  end if;

  return new;
end;
$$;


revoke all on function public.enforce_plan_capacity() from public, anon, authenticated;

comment on function public.enforce_plan_capacity() is
  'Plan kota tetikleyicisi (profiles/customers/properties/branches). Limit = tenant_entitlement_resolve (plan + ofise ozel istisna); koltukta ayrica extra_seats (effective_seat_limit).';

create or replace function public.enforce_tenant_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits record;
  current_usage bigint;
  v_extra_seats integer;
  v_seat_capacity integer;
  v_seat_limit integer;
  v_customer_limit integer;
  v_property_limit integer;
  v_branch_limit integer;
begin
  if new.plan is not distinct from old.plan then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || new.id::text, 0)
  );

  select
    pe.seat_limit,
    pe.customer_limit,
    pe.active_property_limit,
    pe.branch_limit
  into limits
  from public.plan_entitlements pe
  where pe.plan = new.plan;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_ENTITLEMENT_NOT_FOUND:' || new.plan;
  end if;

  -- entitlement-override:v1 (20261013004000): YENI planin limitleri ofise ozel istisnayla cozulur (aktif, suresi
  -- dolmamis, geri alinmamis satirlar). Cozucu yoksa ham plan limitleri (eski davranis).
  v_seat_limit := limits.seat_limit;
  v_customer_limit := limits.customer_limit;
  v_property_limit := limits.active_property_limit;
  v_branch_limit := limits.branch_limit;
  if pg_catalog.to_regprocedure('public.tenant_entitlement_resolve(uuid,text,integer)') is not null then
    v_seat_limit := public.tenant_entitlement_resolve(new.id, 'seats', v_seat_limit);
    v_customer_limit := public.tenant_entitlement_resolve(new.id, 'customers', v_customer_limit);
    v_property_limit := public.tenant_entitlement_resolve(new.id, 'active_properties', v_property_limit);
    v_branch_limit := public.tenant_entitlement_resolve(new.id, 'branches', v_branch_limit);
  end if;

  if v_seat_limit is not null then
    v_seat_capacity := v_seat_limit;
    -- seat-capacity:v1 (20261005000900): etkin koltuk = YENI planin limiti + satin alinmis ek kullanici.
    -- public.effective_seat_limit(new.id) ile AYNI formul; ancak BEFORE UPDATE aninda tenants.plan henuz ESKI
    -- plani gosterdigi icin fonksiyon burada eski plani okurdu. Bu yuzden ek kullanici dogrudan okunur.
    -- effective_seat_limit ya da extra_seats sutunu yoksa eski davranis (yalniz plan limiti) korunur.
    if pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is not null
      and exists (
        select 1
        from pg_catalog.pg_attribute a
        where a.attrelid = 'public.subscriptions'::regclass
          and a.attname = 'extra_seats'
          and a.attnum > 0
          and not a.attisdropped
      ) then
      select s.extra_seats
        into v_extra_seats
      from public.subscriptions s
      where s.tenant_id = new.id;
      if coalesce(v_extra_seats, 0) > 0 then
        v_seat_capacity := v_seat_limit + v_extra_seats;
      end if;
    end if;

    select count(*) into current_usage
    from public.profiles
    where tenant_id = new.id and is_active = true and is_sample = false; -- sample-seat:v1
    if current_usage > v_seat_capacity then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:seats:' || v_seat_capacity::text;
    end if;
  end if;

  if v_customer_limit is not null then
    select count(*) into current_usage
    from public.customers
    where tenant_id = new.id and deleted_at is null;
    if current_usage > v_customer_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:customers:' || v_customer_limit::text;
    end if;
  end if;

  if v_property_limit is not null then
    select count(*) into current_usage
    from public.properties
    where tenant_id = new.id
      and deleted_at is null
      and status in ('draft', 'live', 'reserved');
    if current_usage > v_property_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:active_properties:' || v_property_limit::text;
    end if;
  end if;

  if v_branch_limit is not null then
    select count(*) into current_usage
    from public.branches
    where tenant_id = new.id and is_active = true;
    if current_usage > v_branch_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:branches:' || v_branch_limit::text;
    end if;
  end if;

  return new;
end;
$$;


revoke all on function public.enforce_tenant_plan_capacity() from public, anon, authenticated;

comment on function public.enforce_tenant_plan_capacity() is
  'Plan degisimi kapasite tetikleyicisi. Yeni plan limitleri tenant_entitlement_resolve ile (ofise ozel istisna); koltukta + extra_seats.';
