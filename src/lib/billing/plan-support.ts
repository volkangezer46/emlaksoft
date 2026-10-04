import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSetting } from "@/lib/platform-settings";
import {
  PLAN_DEFINITIONS_SETTING_KEY,
  parsePlanCatalogSettings,
  type PlanCampaignSettings,
} from "@/lib/billing/plan-overrides";

/**
 * Şema/migration hazır mı probları. Forward-only migration'lar (20260817000210/220/230)
 * uygulanana kadar ilgili özellikler GİZLİ kalır; kod şema yokken asla yazmaya kalkmaz.
 * Önbellek kısa tutulur (60 sn) ki migration uygulanınca özellik kendiliğinden açılsın.
 */
export const PLAN_SUPPORT_TAG = "plan-support";

export type PlanSupport = {
  /** subscriptions.price_lock_try / price_lock_campaign var (Founders kilitli fiyat). */
  priceLock: boolean;
  /** billing_trial_days() RPC var (kayıt RPC'si deneme gününü ayardan okur). */
  trialSetting: boolean;
  /** plan_entitlements 'business' satırı var (Business paketi satılabilir). */
  businessPlan: boolean;
  /** coupons tablosu var. */
  coupons: boolean;
  /** plan_entitlements yazılabilir (service_role yazma yetkisi). */
  entitlementWrite: boolean;
};

export const getPlanSupport = unstable_cache(
  async (): Promise<PlanSupport> => {
    const out: PlanSupport = { priceLock: false, trialSetting: false, businessPlan: false, coupons: false, entitlementWrite: false };
    try {
      const admin = createAdminClient();
      const [lock, trial, business, coupons, write] = await Promise.all([
        admin.from("subscriptions").select("price_lock_campaign").limit(1),
        admin.rpc("billing_trial_days"),
        admin.from("plan_entitlements").select("plan").eq("plan", "business").maybeSingle(),
        admin.from("coupons").select("id").limit(1),
        admin.rpc("plan_entitlements_writable"),
      ]);
      out.priceLock = !lock.error;
      out.trialSetting = !trial.error && typeof trial.data === "number";
      out.businessPlan = !business.error && Boolean(business.data);
      out.coupons = !coupons.error;
      out.entitlementWrite = !write.error && write.data === true;
    } catch (e) {
      console.error("getPlanSupport", e);
    }
    return out;
  },
  ["plan-support-v1"],
  { tags: [PLAN_SUPPORT_TAG], revalidate: 60 },
);

/** Gerçekte verilen deneme günü: kayıt RPC'si ayarı okuyorsa panel ayarı, yoksa sabit 14. */
export async function getEffectiveTrialDays(): Promise<number> {
  const support = await getPlanSupport();
  if (!support.trialSetting) return 14;
  const raw = await getPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY);
  const days = parsePlanCatalogSettings(raw).trialDays;
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 14;
}

export type FoundersStatus = {
  /** Şema hazır (kilitli fiyat yazılabilir); değilse kampanya gizlenir ve uygulanmaz. */
  available: boolean;
  active: boolean;
  name: string;
  quota: number;
  /** Gerçek abonelik sayımı: kampanya fiyatıyla başlamış abonelikler. */
  taken: number;
  remaining: number;
};

export async function getFoundersStatus(campaign: PlanCampaignSettings): Promise<FoundersStatus> {
  const base: FoundersStatus = {
    available: false,
    active: campaign.active,
    name: campaign.name,
    quota: campaign.quota,
    taken: 0,
    remaining: 0,
  };
  const support = await getPlanSupport();
  if (!support.priceLock) return base;
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("price_lock_campaign", campaign.name);
    if (error) return base;
    const taken = count ?? 0;
    return { ...base, available: true, taken, remaining: Math.max(0, campaign.quota - taken) };
  } catch (e) {
    console.error("getFoundersStatus", e);
    return base;
  }
}
