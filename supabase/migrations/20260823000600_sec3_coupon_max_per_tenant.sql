-- Güvenlik denetimi 3 / #14 (P2): kupon — ofis başına kullanım sınırı.
--
-- NEDEN: 20260817000230 redeem_coupon yalnız toplam kotayı (max_redemptions) denetliyordu; aynı ofis aynı kuponu
--   her checkout'ta (sınırsız) yeniden kullanabiliyordu.
--
-- NE YAPAR:
--   1. coupons.max_per_tenant integer DEFAULT 1 (NULL = ofis başına sınırsız; > 0 CHECK).
--      DİKKAT: mevcut kuponlar da 1 alır (bulgu kararı: varsayılan 1). Tekrarlı kullanım amaçlı kupon varsa
--      platform ekibi uygulamadan sonra `max_per_tenant = null` (ya da istenen sayı) yapmalıdır.
--   2. redeem_coupon CREATE OR REPLACE — imza, service_role kapısı, FOR UPDATE satır kilidi, geçerlilik/kota/plan
--      kontrolleri ve indirim hesabı AYNEN; ek olarak:
--        * p_tenant_id NULL olamaz;
--        * max_per_tenant doluysa bu ofisin bu kupondaki kullanım sayısı sınırı aşamaz. Sayımda başarısız/
--          terk edilmiş checkout faturaları (invoices.status='void' veya checkout_status 'initialization_failed'/
--          'expired') SAYILMAZ — markCheckoutInvoiceFailed sonrası ofis yeniden deneyebilsin.
--        Yarış güvenliği: kupon satırındaki FOR UPDATE aynı kuponun kullanımlarını sıralar; sayım kilitten sonra
--        yapılır (READ COMMITTED, ifade başına yeni anlık görüntü).
--   3. coupon_redemptions (coupon_id, tenant_id) indeksi (sayım için).
--
-- KOD UYUMU (okundu): src/lib/billing/coupon-server.ts redeemCoupon service_role ile RPC'yi aynı parametrelerle çağırır;
--   hata halinde "Kupon uygulanamadı (kullanım hakkı bitmiş olabilir)." döner ve faturayı başarısız işaretler.
--   quoteCoupon (önizleme) ofis başına sınırı BİLMEZ → kullanıcı önizlemede indirimi görüp tüketimde hata alabilir.
--   Öneri (TS, sahibi onayı): quoteCoupon'a tenantId + aynı sayım; platform kupon formuna max_per_tenant alanı.
-- ETKİ: coupons'a sabit varsayılanlı sütun (PG11+ yalnız katalog), küçük indeks, fonksiyon değişimi.
-- GERİ ALMA: supabase/rollbacks/20260823000600_sec3_coupon_max_per_tenant.rollback.sql
-- RİSK: düşük-orta (mevcut kuponların davranışı ofis başına 1'e iner — yukarıdaki DİKKAT notu).

alter table public.coupons
  add column if not exists max_per_tenant integer default 1;

alter table public.coupons
  drop constraint if exists coupons_max_per_tenant_check;
alter table public.coupons
  add constraint coupons_max_per_tenant_check check (max_per_tenant is null or max_per_tenant > 0);

comment on column public.coupons.max_per_tenant is
  'Ofis başına en çok kullanım (varsayılan 1; NULL = sınırsız). Başarısız/terk edilmiş checkout faturaları sayılmaz.';

create index if not exists idx_coupon_redemptions_coupon_tenant
  on public.coupon_redemptions (coupon_id, tenant_id);

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
  v_used integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Tenant required.' using errcode = '22023';
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
  if v_coupon.max_per_tenant is not null then
    select count(*) into v_used
    from public.coupon_redemptions r
    left join public.invoices i on i.id = r.invoice_id
    where r.coupon_id = v_coupon.id
      and r.tenant_id = p_tenant_id
      and not coalesce(
        i.status = 'void' or i.checkout_status in ('initialization_failed', 'expired'),
        false
      );
    if v_used >= v_coupon.max_per_tenant then
      raise exception 'Coupon already used by this tenant.' using errcode = '22023';
    end if;
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
