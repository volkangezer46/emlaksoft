/**
 * Ofis 360 "Abonelik durumu" penceresinin TUTAR ÖNİZLEMESİ — SAF (testli). `update_tenant_plan_subscription` RPC'sinin
 * (20260825000300, gövdesi 20261014002000'de yalnız plan doğrulamasıyla değişti) tutar dalının TS aynasıdır; pencere
 * katalog fiyatını değil, RPC'nin gerçekten yazacağı tutarı gösterir (B118: "5.490 ₺/ay olarak güncellenecek" yazıp RPC
 * 5.990'ı korurken yanlış bilgi veriliyordu).
 *
 * SQL dalı (aynen):
 *  - plan değişti (sonraki plan ≠ coalesce(abonelik planı, ofis planı)):
 *      fiyat kilidi kampanyası varsa kilit = plan_campaign_lock_amount(yeni plan);
 *      tutar = coalesce(kilit, plan_monthly_amount(yeni plan))  → kaynak "price_lock" | "catalog"
 *  - plan aynı (yalnız durum değişimi dahil): kayıtlı tutar > 0 ise KORUNUR ("preserved");
 *      değilse coalesce(kayıtlı kilit, plan_monthly_amount(plan))  → "price_lock" | "catalog"
 */
export type PlanAmountSource = "preserved" | "price_lock" | "catalog";

export type PlanStatusAmountInput = {
  /** İstenen plan (boşsa ofisin mevcut planı). */
  requestedPlan: string | null;
  tenantPlan: string | null;
  subscriptionPlan: string | null;
  oldAmountTry: number | null;
  oldLockTry: number | null;
  oldLockCampaign: string | null;
  /** `plan_monthly_amount(sonraki plan)`. */
  catalogAmountTry: number | null;
  /** `plan_campaign_lock_amount(sonraki plan)`; yalnız plan değişip kampanya kilidi varsa gerekir. */
  campaignLockAmountTry: number | null;
};

export type PlanStatusAmount = { nextPlan: string | null; planChanged: boolean; amountTry: number | null; source: PlanAmountSource };

const positive = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

/** Sonraki plan ve plan değişikliği (SQL: `v_next_plan is distinct from coalesce(v_sub_plan, v_old_plan)`). */
export function nextPlanOf(i: Pick<PlanStatusAmountInput, "requestedPlan" | "tenantPlan" | "subscriptionPlan">): { nextPlan: string | null; planChanged: boolean } {
  const requested = i.requestedPlan?.trim() || null;
  const nextPlan = requested ?? i.tenantPlan ?? null;
  return { nextPlan, planChanged: nextPlan !== (i.subscriptionPlan ?? i.tenantPlan ?? null) };
}

export function resolvePlanStatusAmount(i: PlanStatusAmountInput): PlanStatusAmount {
  const { nextPlan, planChanged } = nextPlanOf(i);
  if (planChanged) {
    const lock = i.oldLockCampaign ? positive(i.campaignLockAmountTry) : null;
    return { nextPlan, planChanged, amountTry: lock ?? positive(i.catalogAmountTry), source: lock !== null ? "price_lock" : "catalog" };
  }
  const preserved = positive(i.oldAmountTry);
  if (preserved !== null) return { nextPlan, planChanged, amountTry: preserved, source: "preserved" };
  const lock = positive(i.oldLockTry);
  return { nextPlan, planChanged, amountTry: lock ?? positive(i.catalogAmountTry), source: lock !== null ? "price_lock" : "catalog" };
}

export const PLAN_AMOUNT_SOURCE_LABEL: Record<PlanAmountSource, string> = {
  preserved: "mevcut tutar korunur",
  price_lock: "kampanya fiyat kilidi",
  catalog: "katalog fiyatı",
};
