import { unstable_cache } from "next/cache";
import { getPlatformSetting } from "@/lib/platform-settings";
import {
  PLAN_DEFINITIONS_SETTING_KEY,
  catalogPlanDefs,
  quoteFromDefinition,
  type PlanQuote,
  resolveCatalogSettings,
  type PlanCampaignSettings,
  type PlanCatalogSettings,
} from "@/lib/billing/plan-overrides";
import { EF_TARIFF_SETTING_KEY, parseEfTariff, type EfTariff } from "@/lib/ef-credits/config";
import { SEAT_SETTINGS_KEY, parseSeatSettings, type SeatSettings } from "@/lib/billing/seat-settings";
import { PLANS, isPlanId, planAmountOf, planTierOf, visiblePlans, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { getFoundersStatus, getEffectiveTrialDays, type FoundersStatus } from "@/lib/billing/plan-support";

/**
 * PLAN OKUYUCU ARAYÜZÜ (K5 ve fiyatlandırma uygulaması buna bağlanır; sunucuda çağrılır)
 *
 *  getPlanDefinitions(): Promise<PlanDef[]>     tüm tanımlar (gizli dahil), sıraya göre; plans.ts varsayılanı + panel düzenlemesi
 *  getPublicPlanDefinitions(): Promise<PlanDef[]>  yalnız gizli olmayanlar (fiyat/kayıt/yükseltme listeleri)
 *  getPlanDefinition(id): Promise<PlanDef>      tek tanım (bilinmeyen -> office)
 *  getPlanTier(id): Promise<PlanId>             paketin modül kademesi (page-gates; eklenen paket -> kendi `tier`'ı)
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
    return resolveCatalogSettings(raw);
  },
  ["plan-catalog-v5"],
  { tags: [PLAN_DEFINITIONS_TAG], revalidate: 300 },
);

const loadSeatSettings = unstable_cache(
  async (): Promise<SeatSettings> => parseSeatSettings(await getPlatformSetting(SEAT_SETTINGS_KEY)),
  ["seat-settings-v1"],
  { tags: [PLAN_DEFINITIONS_TAG], revalidate: 300 },
);

const loadEfTariff = unstable_cache(
  async (): Promise<EfTariff> => parseEfTariff(await getPlatformSetting(EF_TARIFF_SETTING_KEY)),
  ["ef-tariff-v1"],
  { tags: [PLAN_DEFINITIONS_TAG], revalidate: 300 },
);

/** EmlakFiyati analiz tarifesi (platform_settings; yoksa varsayılan). Plan kartlarındaki "yaklaşık N değerleme" hesabı için. */
export async function getEfTariff(): Promise<EfTariff> {
  return loadEfTariff();
}

/** Ek kullanıcı (koltuk) genel ayarları; kayıt yoksa varsayılan. */
export async function getSeatSettings(): Promise<SeatSettings> {
  return loadSeatSettings();
}

export async function getPlanCatalog(): Promise<PlanCatalogSettings> {
  return loadCatalog();
}

/** Tüm tanımlar (gizli ve arşivli dahil; adminden eklenen paketler dahil). Geriye uyumlu: PLANS ile aynı alanlar + yeni isteğe bağlı alanlar. */
export async function getPlanDefinitions(): Promise<PlanDef[]> {
  const catalog = await loadCatalog();
  return catalogPlanDefs(catalog);
}

export async function getPublicPlanDefinitions(): Promise<PlanDef[]> {
  return visiblePlans(await getPlanDefinitions());
}

export async function getPlanDefinition(id: string): Promise<PlanDef> {
  const defs = await getPlanDefinitions();
  return defs.find((p) => p.id === id) ?? defs.find((p) => p.id === "office") ?? PLANS[1]!;
}

/**
 * Paketin modül kademesi. Taban kimlikte katalog okunmaz (sıcak yol: layout/kapı); eklenen pakette katalogdaki `tier`.
 * Katalogda olmayan kimlik eski davranışla Ofis kademesine düşer.
 */
export async function getPlanTier(planId: string | null | undefined): Promise<PlanId> {
  if (!planId) return "office";
  if (isPlanId(planId)) return planId;
  const def = (await getPlanDefinitions()).find((p) => p.id === planId);
  return def ? planTierOf(def) : "office";
}

/** Liste fiyatından dönem tutarı (kampanya yok). */
export async function getPlanAmountTry(planId: string, cycle: BillingCycle): Promise<number> {
  return planAmountOf(await getPlanDefinition(planId), cycle);
}

/**
 * Ödenecek tutar: önce aboneliğin kilitli (Founders) fiyatı, sonra açık kampanya, yoksa liste.
 * Kampanya yalnız şema hazırsa, aktifse ve kota doluysa uygulanır; sahte kıtlık yoktur.
 */
export async function quotePlan(
  planId: string,
  cycle: BillingCycle,
  lockedMonthlyTry?: number | null,
): Promise<PlanQuote> {
  const [def, catalog] = await Promise.all([getPlanDefinition(planId), loadCatalog()]);
  const locked = Boolean(lockedMonthlyTry && lockedMonthlyTry > 0 && lockedMonthlyTry < def.monthlyTry);
  // Kilitli abonelikte kampanya kotası sorgulanmaz (sonuç kilitle belirlenir).
  const founders = locked ? null : await getFoundersStatus(catalog.campaign);
  return quoteFromDefinition(def, cycle, {
    lockedMonthlyTry,
    campaign: catalog.campaign,
    campaignOpen: Boolean(founders && founders.available && founders.remaining > 0),
  });
}

export type { FoundersStatus, PlanCampaignSettings, PlanQuote };
export { quoteFromDefinition };
export { getFoundersStatus, getEffectiveTrialDays };
