import { unstable_cache } from "next/cache";
import { getPlatformSetting } from "@/lib/platform-settings";
import {
  PLAN_DEFINITIONS_SETTING_KEY,
  applyPlanOverrides,
  parsePlanOverrides,
} from "@/lib/billing/plan-overrides";
import { PLANS, planAmountOf, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";

/** Yazma sonrası `updateTag(PLAN_DEFINITIONS_TAG)` ile anında düşer. */
export const PLAN_DEFINITIONS_TAG = "plan-definitions";

/**
 * Etkin paket tanımları: panelde düzenlenmiş `platform_settings` kaydı varsa o,
 * yoksa/okunamazsa plans.ts varsayılanı. Geriye uyumlu: dönüş biçimi `PLANS` ile aynıdır.
 * Yalnız sunucuda çağrılır (istemci bileşenlerine prop olarak geçirilir).
 */
export const getPlanDefinitions = unstable_cache(
  async (): Promise<PlanDef[]> => {
    const raw = await getPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY);
    return applyPlanOverrides(parsePlanOverrides(raw));
  },
  ["plan-definitions-v1"],
  { tags: [PLAN_DEFINITIONS_TAG], revalidate: 300 },
);

export async function getPlanDefinition(id: string): Promise<PlanDef> {
  const defs = await getPlanDefinitions();
  return defs.find((p) => p.id === id) ?? defs.find((p) => p.id === "office") ?? PLANS[1]!;
}

/** Checkout / faturalama tutarı: etkin (panelden düzenlenmiş) fiyattan. */
export async function getPlanAmountTry(planId: PlanId, cycle: BillingCycle): Promise<number> {
  return planAmountOf(await getPlanDefinition(planId), cycle);
}
