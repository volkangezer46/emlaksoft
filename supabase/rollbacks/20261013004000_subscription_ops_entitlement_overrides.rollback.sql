-- 20261013004000 geri alma: kapasite tetikleyicileri ve effective_seat_limit 20260825000600/000500 govdelerine doner,
-- ofise ozel limit istisnalari tablosu ve cozucu silinir, eklenen sutunlar kaldirilir.
-- UYARI: verilmis limit istisnalari, taahhut bitisleri, yonetici iptal kodu/notu ve tahsil denemesi hata metinleri
-- KAYBOLUR (denetim izi platform_audit_logs'ta kalir). Kod sutun/tablo yokken eski davranisa duser.

-- 1. Tetikleyiciler ve effective_seat_limit eski govdeye (cozucuye bagimliligi once kaldir)
create or replace function public.effective_seat_limit(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when pe.seat_limit is null then null
              else pe.seat_limit + coalesce(s.extra_seats, 0) end
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  left join public.subscriptions s on s.tenant_id = t.id
  where t.id = p_tenant_id;
$$;

revoke all privileges on function public.effective_seat_limit(uuid) from public, anon, authenticated;
grant execute on function public.effective_seat_limit(uuid) to service_role;

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
      should_check := new.is_active and (
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
      where tenant_id = target_tenant and is_active = true;
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
  'Plan kota tetikleyicisi (profiles/customers/properties/branches). Koltuk: effective_seat_limit (plan + extra_seats); yoksa plan limiti.';

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

  if limits.seat_limit is not null then
    v_seat_capacity := limits.seat_limit;
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
        v_seat_capacity := limits.seat_limit + v_extra_seats;
      end if;
    end if;

    select count(*) into current_usage
    from public.profiles
    where tenant_id = new.id and is_active = true;
    if current_usage > v_seat_capacity then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:seats:' || v_seat_capacity::text;
    end if;
  end if;

  if limits.customer_limit is not null then
    select count(*) into current_usage
    from public.customers
    where tenant_id = new.id and deleted_at is null;
    if current_usage > limits.customer_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:customers:' || limits.customer_limit::text;
    end if;
  end if;

  if limits.active_property_limit is not null then
    select count(*) into current_usage
    from public.properties
    where tenant_id = new.id
      and deleted_at is null
      and status in ('draft', 'live', 'reserved');
    if current_usage > limits.active_property_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:active_properties:' || limits.active_property_limit::text;
    end if;
  end if;

  if limits.branch_limit is not null then
    select count(*) into current_usage
    from public.branches
    where tenant_id = new.id and is_active = true;
    if current_usage > limits.branch_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:branches:' || limits.branch_limit::text;
    end if;
  end if;

  return new;
end;
$$;


revoke all on function public.enforce_tenant_plan_capacity() from public, anon, authenticated;

comment on function public.enforce_tenant_plan_capacity() is
  'Plan degisimi kapasite tetikleyicisi. Koltuk: yeni plan limiti + extra_seats (effective_seat_limit ile ayni formul).';

-- 2. Cozucu ve istisna tablosu
drop function if exists public.current_tenant_seat_limit();
drop function if exists public.tenant_entitlement_resolve(uuid, text, integer);
drop table if exists public.tenant_entitlement_overrides;

-- 3. Eklenen sutunlar
alter table public.invoices drop constraint if exists invoices_checkout_error_check;
alter table public.invoices drop column if exists checkout_error;
alter table public.subscriptions drop constraint if exists subscriptions_cancel_reason_code_check;
alter table public.subscriptions drop constraint if exists subscriptions_cancel_note_check;
alter table public.subscriptions
  drop column if exists cancel_note,
  drop column if exists cancel_reason_code,
  drop column if exists commitment_end_at;

notify pgrst, 'reload schema';
