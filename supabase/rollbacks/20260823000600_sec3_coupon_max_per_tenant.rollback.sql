-- Rollback: 20260823000600_sec3_coupon_max_per_tenant
-- UYARI: bulgu #14 yeniden açılır (ofis başına sınırsız kupon kullanımı). max_per_tenant değerleri kaybolur.

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

drop index if exists public.idx_coupon_redemptions_coupon_tenant;
alter table public.coupons drop constraint if exists coupons_max_per_tenant_check;
alter table public.coupons drop column if exists max_per_tenant;

notify pgrst, 'reload schema';
