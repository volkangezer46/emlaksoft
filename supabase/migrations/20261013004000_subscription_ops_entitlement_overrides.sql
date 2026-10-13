-- 20261013004000 — Abonelik operasyon konsolu (AD1): ofise ozel limit istisnasi + anlasma alanlari.
--
-- Kapsam (forward-only; mevcut veriye DOKUNMAZ, yalniz ekler):
--   A. subscriptions: commitment_end_at (taahhut bitisi), cancel_reason_code + cancel_note (yonetici iptalinde
--      neden kodu ve not; cancel_reason raporlar icin okunur etiketi tasir).
--   B. invoices.checkout_error: tahsil denemesinin saglayici hata metni (yazari otomatik yenileme/odeme akislari;
--      bos kalabilir, ekran o durumda checkout_status'tan okunur aciklama gosterir).
--   C. tenant_entitlement_overrides: ofise ozel limit istisnasi (+N koltuk/portfoy/musteri/sube ya da sabit deger),
--      bitis tarihli olabilir; geri alma SILMEZ (revoked_at), denetim izi korunur. Yalniz service_role yazar,
--      platform personeli okur.
--   D. tenant_entitlement_resolve(uuid,text,integer): TEK cozucu. Etkin limit = (en yeni aktif sabit deger, yoksa plan
--      limiti) + aktif artislarin toplami; plan sinirsizsa (NULL) sinirsiz kalir. Aktif = geri alinmamis ve
--      (bitisi yok ya da bitis > now()). Bitis aninda eski limit kendiliginden doner (cron gerekmez).
--   E. effective_seat_limit + enforce_plan_capacity + enforce_tenant_plan_capacity cozucuye baglanir
--      (TAM govde; kaynak 20260825000600, canli govde md5 on-kosuluyla). Isaret: 'entitlement-override:v1'.
--
-- Kod sutun/tablo yokken eski davranisa duser (konsol "kurulum bekliyor" der). Geri alma:
-- supabase/rollbacks/20261013004000_subscription_ops_entitlement_overrides.rollback.sql

-- ---------------------------------------------------------------------------
-- 0. On kosul: kapasite tetikleyicilerinin canli govdesi 20260825000600 ile ayni (ya da bu dosya zaten uygulanmis)
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.enforce_plan_capacity()');
  if v_src is null then
    raise exception '20261013004000: enforce_plan_capacity() yok.';
  end if;
  if position('entitlement-override:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> 'e7cdf30c88c0ff4ef67077e5c3f1cdd7' then
    raise exception '20261013004000: enforce_plan_capacity canli govdesi 20260825000600 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  v_src := null;
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.enforce_tenant_plan_capacity()');
  if v_src is null then
    raise exception '20261013004000: enforce_tenant_plan_capacity() yok.';
  end if;
  if position('entitlement-override:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> 'bf75fbeb7e4336a8dcf42babd77d0917' then
    raise exception '20261013004000: enforce_tenant_plan_capacity canli govdesi 20260825000600 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  if pg_catalog.to_regprocedure('public.effective_seat_limit(uuid)') is null then
    raise exception '20261013004000: effective_seat_limit(uuid) yok (20260825000500).';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- A. subscriptions: taahhut ve yonetici iptal nedeni
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists commitment_end_at timestamptz,
  add column if not exists cancel_reason_code text,
  add column if not exists cancel_note text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'subscriptions_cancel_reason_code_check') then
    alter table public.subscriptions add constraint subscriptions_cancel_reason_code_check
      check (cancel_reason_code is null or cancel_reason_code ~ '^[a-z_]{2,40}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'subscriptions_cancel_note_check') then
    alter table public.subscriptions add constraint subscriptions_cancel_note_check
      check (cancel_note is null or char_length(cancel_note) <= 500);
  end if;
end
$$;

comment on column public.subscriptions.commitment_end_at is
  'Ofise ozel anlasmada taahhut bitisi (yonetici girer; bilgi amacli, otomatik islem yok).';
comment on column public.subscriptions.cancel_reason_code is
  'Yonetici iptalinde neden kodu (fiyat, kullanmiyor ...); okunur etiket cancel_reason''da.';

-- ---------------------------------------------------------------------------
-- B. invoices: tahsil denemesi hata metni
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists checkout_error text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'invoices_checkout_error_check') then
    alter table public.invoices add constraint invoices_checkout_error_check
      check (checkout_error is null or char_length(checkout_error) <= 300);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- C. tenant_entitlement_overrides
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key in ('seats', 'active_properties', 'customers', 'branches')),
  -- Tam olarak biri dolu: delta = plan limitine eklenen (+N), value = plan limiti yerine gecen sabit deger.
  delta integer null check (delta is null or (delta >= 1 and delta <= 10000)),
  value integer null check (value is null or (value >= 1 and value <= 1000000)),
  expires_at timestamptz null,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  created_by uuid null references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references public.platform_staff(id) on delete set null,
  revoke_reason text null check (revoke_reason is null or char_length(revoke_reason) <= 500),
  constraint tenant_entitlement_overrides_one_kind check ((delta is null) <> (value is null)),
  constraint tenant_entitlement_overrides_expiry check (expires_at is null or expires_at > created_at)
);

create index if not exists tenant_entitlement_overrides_active_idx
  on public.tenant_entitlement_overrides (tenant_id, key)
  where revoked_at is null;

alter table public.tenant_entitlement_overrides enable row level security;
alter table public.tenant_entitlement_overrides force row level security;

drop policy if exists tenant_entitlement_overrides_staff_select on public.tenant_entitlement_overrides;
create policy tenant_entitlement_overrides_staff_select on public.tenant_entitlement_overrides
  for select to authenticated
  using ((select public.is_platform_staff()));

revoke all privileges on table public.tenant_entitlement_overrides from public, anon, authenticated, service_role;
grant select on table public.tenant_entitlement_overrides to authenticated;
grant select, insert, update on table public.tenant_entitlement_overrides to service_role;

comment on table public.tenant_entitlement_overrides is
  'Ofise ozel limit istisnasi (Ofis 360 > Abonelik). Etkin limit tenant_entitlement_resolve ile; geri alma revoked_at.';

-- ---------------------------------------------------------------------------
-- D. Tek cozucu
-- ---------------------------------------------------------------------------
create or replace function public.tenant_entitlement_resolve(p_tenant_id uuid, p_key text, p_plan_limit integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_plan_limit is null then null
    else least(
      1000000,
      greatest(
        1,
        coalesce(
          (select o.value
             from public.tenant_entitlement_overrides o
            where o.tenant_id = p_tenant_id
              and o.key = p_key
              and o.value is not null
              and o.revoked_at is null
              and (o.expires_at is null or o.expires_at > now())
            order by o.created_at desc, o.id desc
            limit 1),
          p_plan_limit
        )::bigint
        + coalesce(
          (select sum(o.delta)::bigint
             from public.tenant_entitlement_overrides o
            where o.tenant_id = p_tenant_id
              and o.key = p_key
              and o.delta is not null
              and o.revoked_at is null
              and (o.expires_at is null or o.expires_at > now())),
          0
        )
      )
    )::integer
  end;
$$;

revoke all privileges on function public.tenant_entitlement_resolve(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tenant_entitlement_resolve(uuid, text, integer) to service_role;

comment on function public.tenant_entitlement_resolve(uuid, text, integer) is
  'entitlement-override:v1 — etkin limit = (en yeni aktif sabit deger ya da plan limiti) + aktif artislar; NULL plan limiti sinirsiz kalir.';

-- ---------------------------------------------------------------------------
-- E1. effective_seat_limit: plan limiti (istisnayla) + satin alinmis ek kullanici
-- ---------------------------------------------------------------------------
create or replace function public.effective_seat_limit(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- entitlement-override:v1 (20261013004000): plan limiti ofise ozel istisnayla cozulur, sonra ek kullanici eklenir.
  select case when pe.seat_limit is null then null
              else public.tenant_entitlement_resolve(t.id, 'seats', pe.seat_limit) + coalesce(s.extra_seats, 0) end
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  left join public.subscriptions s on s.tenant_id = t.id
  where t.id = p_tenant_id;
$$;

revoke all privileges on function public.effective_seat_limit(uuid) from public, anon, authenticated;
grant execute on function public.effective_seat_limit(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- E2. enforce_plan_capacity (kaynak: 20260825000600; tam govde + istisna cozucusu)
-- ---------------------------------------------------------------------------
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
  'Plan kota tetikleyicisi (profiles/customers/properties/branches). Limit = tenant_entitlement_resolve (plan + ofise ozel istisna); koltukta ayrica extra_seats (effective_seat_limit).';

-- ---------------------------------------------------------------------------
-- E3. enforce_tenant_plan_capacity (kaynak: 20260825000600; tam govde, yeni plan limitleri istisnayla)
-- ---------------------------------------------------------------------------
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
    where tenant_id = new.id and is_active = true;
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

notify pgrst, 'reload schema';
