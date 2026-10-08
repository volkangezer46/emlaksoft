import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanCampaignSettings } from "@/lib/billing/plan-overrides";

/**
 * Şema/migration hazır mı probları. Forward-only migration'lar (20260817000210/220/230; deneme günü için
 * K1'in 20260816010100) uygulanana kadar ilgili özellikler GİZLİ kalır; kod şema yokken asla yazmaya kalkmaz.
 * Önbellek kısa tutulur (60 sn) ki migration uygulanınca özellik kendiliğinden açılsın.
 */
export const PLAN_SUPPORT_TAG = "plan-support";

export type PlanSupport = {
  /** subscriptions.price_lock_try / price_lock_campaign var (Founders kilitli fiyat). */
  priceLock: boolean;
  /** K1'in platform_default_trial_days() yardımcısı var (kayıt/demo dönüşümü deneme gününü ayardan okur). */
  trialSetting: boolean;
  /** Gerçekte verilen deneme günü (yardımcı yoksa sabit 14). */
  trialDays: number;
  /** plan_entitlements 'business' satırı var (Business paketi satılabilir). */
  businessPlan: boolean;
  /** coupons tablosu var. */
  coupons: boolean;
  /** plan_entitlements yazılabilir (service_role yazma yetkisi). */
  entitlementWrite: boolean;
  /** 20261007001000: duraklatma + planlı düşürme sütunları ve RPC'leri var (subscription_pause_ready()). */
  pauseReady: boolean;
  /** 20261007001010: fulfill gövdeleri plan_upgrade faturasını işliyor (plan_upgrade_ready()). */
  upgradeReady: boolean;
};

export const getPlanSupport = unstable_cache(
  async (): Promise<PlanSupport> => {
    const out: PlanSupport = { priceLock: false, trialSetting: false, trialDays: 14, businessPlan: false, coupons: false, entitlementWrite: false, pauseReady: false, upgradeReady: false };
    try {
      const admin = createAdminClient();
      const [lock, trial, business, coupons, write, pause, upgrade] = await Promise.all([
        admin.from("subscriptions").select("price_lock_campaign").limit(1),
        admin.rpc("platform_default_trial_days"),
        admin.from("plan_entitlements").select("plan").eq("plan", "business").maybeSingle(),
        admin.from("coupons").select("id").limit(1),
        admin.rpc("plan_entitlements_writable"),
        admin.rpc("subscription_pause_ready"),
        admin.rpc("plan_upgrade_ready"),
      ]);
      out.priceLock = !lock.error;
      out.trialSetting = !trial.error && typeof trial.data === "number";
      if (out.trialSetting) out.trialDays = Number(trial.data);
      out.businessPlan = !business.error && Boolean(business.data);
      out.coupons = !coupons.error;
      out.entitlementWrite = !write.error && write.data === true;
      out.pauseReady = !pause.error && pause.data === true;
      out.upgradeReady = out.pauseReady && !upgrade.error && upgrade.data === true;
    } catch (e) {
      console.error("getPlanSupport", e);
    }
    return out;
  },
  ["plan-support-v3"],
  { tags: [PLAN_SUPPORT_TAG], revalidate: 60 },
);

/**
 * Gerçekte verilen deneme günü. TEK kaynak: K1'in platform_default_trial_days() yardımcısı
 * (platform_settings.default_trial_days). Yardımcı yoksa kayıt RPC'si sabit 14 gün verir.
 */
export async function getEffectiveTrialDays(): Promise<number> {
  return (await getPlanSupport()).trialDays;
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
