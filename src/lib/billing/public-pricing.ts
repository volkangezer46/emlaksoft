import { efUnitsFor } from "@/lib/ef-credits/config";
import {
  getEfTariff,
  getFoundersStatus,
  getEffectiveTrialDays,
  getPlanCatalog,
  getPublicPlanDefinitions,
} from "@/lib/billing/plan-definitions";
import { effectiveMonthlyTry } from "@/lib/billing/plan-overrides";
import type { PlanDef } from "@/lib/billing/plans";

/**
 * PUBLIC FİYAT VERİSİ (sunucu): ana sayfa, /fiyatlar, /kayit ve SEO aynı tek okuyucudan beslenir.
 * Kaynak: admin /admin/billing/planlar (platform_settings) -> plan-definitions.ts okuyucuları.
 * Yeni mantık yoktur; yalnız mevcut okuyucuların sonuçlarını bir araya getirir.
 */
export type PublicOffer = {
  /** Etkin aylık fiyat (açık kampanya dahil, KDV hariç). */
  monthlyTry: number;
  /** Liste aylık fiyatı. */
  listMonthlyTry: number;
  /** true: kampanya fiyatı uygulanıyor (monthlyTry < listMonthlyTry). */
  campaign: boolean;
};

export type PublicFounders = { name: string; remaining: number; quota: number };

export type PublicPricing = {
  plans: PlanDef[];
  /** Gerçekte verilen deneme günü (getEffectiveTrialDays). */
  trialDays: number;
  offers: Record<string, PublicOffer>;
  /** Yalnız kampanya aktif, şema hazır, kota dolu değil ve en az bir planda indirimli fiyat varsa. */
  founders: PublicFounders | null;
  /** Bir değerlemenin kontör bedeli (tarifeden); "yaklaşık N değerleme" satırı için. */
  efValuationCost: number;
};

export async function getPublicPricing(): Promise<PublicPricing> {
  const [plans, catalog, trialDays, efTariff] = await Promise.all([
    getPublicPlanDefinitions(),
    getPlanCatalog(),
    getEffectiveTrialDays(),
    getEfTariff(),
  ]);
  const status = await getFoundersStatus(catalog.campaign);
  const open = status.available && status.active && status.remaining > 0;
  const offers: Record<string, PublicOffer> = {};
  for (const p of plans) {
    const monthly = effectiveMonthlyTry(p, catalog.campaign, open);
    offers[p.id] = { monthlyTry: monthly, listMonthlyTry: p.monthlyTry, campaign: monthly < p.monthlyTry };
  }
  const anyCampaign = Object.values(offers).some((o) => o.campaign);
  return {
    plans,
    trialDays,
    offers,
    founders: open && anyCampaign ? { name: status.name, remaining: status.remaining, quota: status.quota } : null,
    efValuationCost: efUnitsFor("valuation_arsa", efTariff),
  };
}
