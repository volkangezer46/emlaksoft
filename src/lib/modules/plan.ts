import { lockedGate, requiredPlanName, type GateContext } from "@/lib/billing/page-gates";
import { FEATURE_KEYS, getModuleDef, modulePlanRequirement, type FeatureKey } from "@/lib/modules/registry";

/**
 * Modül kartının paket bilgisi. Tek kaynak `PLAN_GATES` (registry `modulePlanRequirement`);
 * burada yalnız "bu ofiste şu an kilitli mi" hesaplanır. Modülün ilk rotası kilitliyse modül
 * paketle kilitli sayılır (ofis açıp kapatamaz; ön ayarlar da dokunmaz).
 */
export type ModulePlanInfo = {
  /** Gerekli en düşük paketin görünen adı (her pakette açıksa null). */
  requiredPlan: string | null;
  /** Bu ofisin paketinde kilitli mi? */
  locked: boolean;
  /** Yükseltme sayfası bağlantısı (kilitliyse). */
  upgradeHref: string | null;
};

export function modulePlanInfo(key: FeatureKey, ctx: GateContext): ModulePlanInfo {
  const requirement = modulePlanRequirement(key);
  const first = getModuleDef(key).routes[0];
  const gate = first ? lockedGate(first, ctx) : null;
  return {
    requiredPlan: requirement ? requiredPlanName(requirement) : null,
    locked: gate !== null,
    upgradeHref: gate ? `/app/paket?ozellik=${encodeURIComponent(gate.href)}` : null,
  };
}

/** Bu ofiste paketle kilitli modül anahtarları. */
export function planLockedKeys(ctx: GateContext): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => modulePlanInfo(k, ctx).locked);
}
