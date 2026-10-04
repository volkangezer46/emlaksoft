-- K2: Kupon / indirim (forward-only). Yalnız service_role erişir; ofisler kuponu checkout sunucu akışında kullanır.
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  description text check (description is null or char_length(description) <= 200),
  kind text not null check (kind in ('percent', 'amount')),
  value numeric not null check (value > 0),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  plan_ids text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create unique index if not exists uq_coupons_code on public.coupons (code);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  discount_try numeric not null check (discount_try >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_coupon_redemptions_coupon on public.coupon_redemptions (coupon_id, created_at desc);
create index if not exists idx_coupon_redemptions_tenant on public.coupon_redemptions (tenant_id);
create unique index if not exists uq_coupon_redemptions_invoice
  on public.coupon_redemptions (invoice_id) where invoice_id is not null;

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
revoke all privileges on table public.coupons from public, anon, authenticated;
revoke all privileges on table public.coupon_redemptions from public, anon, authenticated;
grant all privileges on table public.coupons to service_role;
grant all privileges on table public.coupon_redemptions to service_role;

-- Atomik kullanım: kota ve geçerlilik tek satır kilidinde doğrulanır (çift kullanım olmaz).
create or replace function public.redeem_coupon(
  p_code text,
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_plan text,
  p_base_amount_try numeric
)
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons%rowtype;
  v_discount numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select * into v_coupon from public.coupons where code = upper(btrim(p_code)) for update;
  if not found or not v_coupon.is_active then
    raise exception 'Coupon not found.' using errcode = 'P0002';
  end if;
  if (v_coupon.valid_from is not null and now() < v_coupon.valid_from)
    or (v_coupon.valid_until is not null and now() > v_coupon.valid_until) then
    raise exception 'Coupon expired.' using errcode = '22023';
  end if;
  if v_coupon.max_redemptions is not null and v_coupon.redeemed_count >= v_coupon.max_redemptions then
    raise exception 'Coupon exhausted.' using errcode = '22023';
  end if;
  if array_length(v_coupon.plan_ids, 1) is not null and not (p_plan = any (v_coupon.plan_ids)) then
    raise exception 'Coupon not valid for plan.' using errcode = '22023';
  end if;
  if p_base_amount_try is null or p_base_amount_try <= 0 then
    raise exception 'Invalid base amount.' using errcode = '22023';
  end if;
  v_discount := case v_coupon.kind
    when 'percent' then round(p_base_amount_try * v_coupon.value / 100, 2)
    else least(v_coupon.value, p_base_amount_try)
  end;
  v_discount := least(v_discount, p_base_amount_try - 1);
  if v_discount < 0 then v_discount := 0; end if;
  insert into public.coupon_redemptions (coupon_id, tenant_id, invoice_id, discount_try)
  values (v_coupon.id, p_tenant_id, p_invoice_id, v_discount);
  update public.coupons set redeemed_count = redeemed_count + 1, updated_at = now() where id = v_coupon.id;
  return v_discount;
end;
$$;

revoke all privileges on function public.redeem_coupon(text, uuid, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.redeem_coupon(text, uuid, uuid, text, numeric) to service_role;

notify pgrst, 'reload schema';
