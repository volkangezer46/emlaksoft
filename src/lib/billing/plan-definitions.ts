import { unstable_cache } from "next/cache";
import { getPlatformSetting } from "@/lib/platform-settings";
import {
  PLAN_DEFINITIONS_SETTING_KEY,
  applyPlanOverrides,
  effectiveMonthlyTry,
  parsePlanCatalogSettings,
  type PlanCampaignSettings,
  type PlanCatalogSettings,
} from "@/lib/billing/plan-overrides";
import { SEAT_SETTINGS_KEY, parseSeatSettings, type SeatSettings } from "@/lib/billing/seat-settings";
import { PLANS, planAmountOf, visiblePlans, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { getFoundersStatus, getEffectiveTrialDays, type FoundersStatus } from "@/lib/billing/plan-support";

/**
 * PLAN OKUYUCU ARAYÜZÜ (K5 ve fiyatlandırma uygulaması buna bağlanır; sunucuda çağrılır)
 *
 *  getPlanDefinitions(): Promise<PlanDef[]>     tüm tanımlar (gizli dahil), sıraya göre; plans.ts varsayılanı + panel düzenlemesi
 *  getPublicPlanDefinitions(): Promise<PlanDef[]>  yalnız gizli olmayanlar (fiyat/kayıt/yükseltme listeleri)
 *  getPlanDefinition(id): Promise<PlanDef>      tek tanım (bilinmeyen -> office)
 *  getPlanCatalog(): Promise<PlanCatalogSettings>  düzenlemeler + kampanya ayarı + istenen deneme günü
 *  getPlanAmountTry(id, cycle): Promise<number> liste fiyatından dönem tutarı (KDV hariç)
 *  quotePlan(id, cycle, tenantId?): Promise<PlanQuote> kampanya/kilitli fiyat dahil ödenecek tutar
 *  getSeatSettings(): Promise<SeatSettings>     koltuk doluluk uyarı eşiği (admin ayarı; varsayılan %80)
 *  getFoundersStatus(): Promise<FoundersStatus> kampanya durumu (gerçek abonelik sayımı; şema yoksa available=false)
 *  getEffectiveTrialDays(): Promise<number>     gerçekten verilen deneme günü (migration yoksa 14)
 *
 * Yazma sonrası `updateTag(PLAN_DEFINITIONS_TAG)` çağrılır. Hata/yoksa plans.ts varsayılanı döner.
 */

/** Yazma sonrası `updateTag(PLAN_DEFINITIONS_TAG)` ile anında düşer. */
export const PLAN_DEFINITIONS_TAG = "plan-definitions";

const loadCatalog = unstable_cache(
  async (): Promise<PlanCatalogSettings> => {
    const raw = await getPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY);
    return parsePlanCatalogSettings(raw);
  },
  ["plan-catalog-v3"],
  { tags: [PLAN_DEFINITIONS_TAG], revalidate: 300 },
);

const loadSeatSettings = unstable_cache(
  async (): Promise<SeatSettings> => parseSeatSettings(await getPlatformSetting(SEAT_SETTINGS_KEY)),
  ["seat-settings-v1"],
  { tags: [PLAN_DEFINITIONS_TAG], revalidate: 300 },
);

/** Ek kullanıcı (koltuk) genel ayarları; kayıt yoksa varsayılan. */
export async function getSeatSettings(): Promise<SeatSettings> {
  return loadSeatSettings();
}

export async function getPlanCatalog(): Promise<PlanCatalogSettings> {
  return loadCatalog();
}

/** Tüm tanımlar (gizli dahil). Geriye uyumlu: PLANS ile aynı alanlar + yeni isteğe bağlı alanlar. */
export async function getPlanDefinitions(): Promise<PlanDef[]> {
  const catalog = await loadCatalog();
  return applyPlanOverrides(catalog.overrides);
}

export async function getPublicPlanDefinitions(): Promise<PlanDef[]> {
  return visiblePlans(await getPlanDefinitions());
}

export async function getPlanDefinition(id: string): Promise<PlanDef> {
  const defs = await getPlanDefinitions();
  return defs.find((p) => p.id === id) ?? defs.find((p) => p.id === "office") ?? PLANS[1]!;
}

/** Liste fiyatından dönem tutarı (kampanya yok). */
export async function getPlanAmountTry(planId: PlanId, cycle: BillingCycle): Promise<number> {
  return planAmountOf(await getPlanDefinition(planId), cycle);
}

export type PlanQuote = {
  /** Ödenecek dönem tutarı (KDV hariç). */
  amountTry: number;
  /** Etkin aylık fiyat (kampanya/kilit dahil). */
  monthlyTry: number;
  listMonthlyTry: number;
  source: "list" | "campaign" | "locked";
  campaignName?: string;
};

/**
 * Ödenecek tutar: önce aboneliğin kilitli (Founders) fiyatı, sonra açık kampanya, yoksa liste.
 * Kampanya yalnız şema hazırsa, aktifse ve kota doluysa uygulanır; sahte kıtlık yoktur.
 */
export async function quotePlan(
  planId: PlanId,
  cycle: BillingCycle,
  lockedMonthlyTry?: number | null,
): Promise<PlanQuote> {
  const [def, catalog] = await Promise.all([getPlanDefinition(planId), loadCatalog()]);
  const list = def.monthlyTry;
  if (lockedMonthlyTry && lockedMonthlyTry > 0 && lockedMonthlyTry < list) {
    return {
      amountTry: planAmountOf({ ...def, monthlyTry: lockedMonthlyTry }, cycle),
      monthlyTry: lockedMonthlyTry,
      listMonthlyTry: list,
      source: "locked",
      campaignName: catalog.campaign.name,
    };
  }
  const founders = await getFoundersStatus(catalog.campaign);
  const open = founders.available && founders.remaining > 0;
  const monthly = effectiveMonthlyTry(def, catalog.campaign, open);
  const isCampaign = monthly < list;
  return {
    amountTry: planAmountOf({ ...def, monthlyTry: monthly }, cycle),
    monthlyTry: monthly,
    listMonthlyTry: list,
    source: isCampaign ? "campaign" : "list",
    campaignName: isCampaign ? catalog.campaign.name : undefined,
  };
}

export type { FoundersStatus, PlanCampaignSettings };
export { getFoundersStatus, getEffectiveTrialDays };
