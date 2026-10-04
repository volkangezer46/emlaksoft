import { createAdminClient } from "@/lib/supabase/admin";
import { computeCouponDiscount, normalizeCouponCode, type CouponKind } from "@/lib/billing/coupon";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { now as clockNow } from "@/lib/clock";

export type CouponQuote = { ok: true; code: string; discountTry: number } | { ok: false; error: string };

/**
 * Kuponu TÜKETMEDEN doğrular ve indirimi hesaplar (checkout fatura tutarı için).
 * Gerçek tüketim `redeem_coupon` RPC'siyle (satır kilidi + kota) fatura oluştuktan sonra yapılır.
 */
export async function quoteCoupon(rawCode: string, plan: string, baseAmountTry: number): Promise<CouponQuote> {
  const code = normalizeCouponCode(rawCode);
  const support = await getPlanSupport();
  if (!support.coupons) return { ok: false, error: "Kupon kullanımı şu an kapalı." };
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("coupons")
    .select("code, kind, value, max_redemptions, redeemed_count, valid_from, valid_until, plan_ids, is_active")
    .eq("code", code)
    .maybeSingle();
  if (!c || !c.is_active) return { ok: false, error: "Kupon kodu geçersiz." };
  const nowMs = clockNow();
  if ((c.valid_from && nowMs < Date.parse(c.valid_from)) || (c.valid_until && nowMs > Date.parse(c.valid_until))) {
    return { ok: false, error: "Kuponun geçerlilik süresi dışında." };
  }
  if (c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions) return { ok: false, error: "Kuponun kullanım hakkı bitti." };
  if (Array.isArray(c.plan_ids) && c.plan_ids.length > 0 && !c.plan_ids.includes(plan)) {
    return { ok: false, error: "Kupon seçilen paket için geçerli değil." };
  }
  const discountTry = computeCouponDiscount(c.kind as CouponKind, Number(c.value), baseAmountTry);
  if (discountTry <= 0) return { ok: false, error: "Kupon bu tutara uygulanamıyor." };
  return { ok: true, code: c.code, discountTry };
}

/** Faturaya bağlı atomik tüketim. Dönen indirim, teklif edilenle aynı değilse çağıran faturayı başarısız işaretler. */
export async function redeemCoupon(input: {
  code: string;
  tenantId: string;
  invoiceId: string;
  plan: string;
  baseAmountTry: number;
}): Promise<{ ok: true; discountTry: number } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("redeem_coupon", {
    p_code: input.code,
    p_tenant_id: input.tenantId,
    p_invoice_id: input.invoiceId,
    p_plan: input.plan,
    p_base_amount_try: input.baseAmountTry,
  });
  if (error) {
    console.error("redeemCoupon", error.code, error.message);
    return { ok: false, error: "Kupon uygulanamadı (kullanım hakkı bitmiş olabilir)." };
  }
  return { ok: true, discountTry: Number(data) };
}
