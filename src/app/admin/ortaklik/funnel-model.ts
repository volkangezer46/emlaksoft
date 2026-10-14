import type { FunnelStage } from "@/components/ui/viz";
import type { GrowthMetrics, ReadinessCheck } from "@/lib/growth/program";

/**
 * Büyüme sayfası saf hesapları (görünüm modeli). Veri uydurmaz: ölçülmeyen aşama (ayrı "deneme"
 * sayacı yok) huniye eklenmez; kayıt -> ödeyen oranı "deneme -> ödeme" dönüşümüdür.
 */

export function pctOf(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || !(whole > 0) || !Number.isFinite(part)) return null;
  return Math.round((part / whole) * 100);
}

function sub(conv: number | null, from: string): string | undefined {
  return conv == null ? undefined : `%${conv} ${from} sonrası`;
}

export type FunnelHrefs = { clicks: string; signups: string; payers: string; rewards: string };

/** Tıklama -> kayıt -> ödeyen -> ödül (ödenen talep). Aşamalar bağımsız sayımlar olduğundan oranlar sub etiketindedir. */
export function buildGrowthFunnel(m: GrowthMetrics, paidClaims: number, href: FunnelHrefs): FunnelStage[] {
  return [
    { label: "Bağlantı tıklaması", value: m.clicks, href: href.clicks },
    { label: "Davetle kayıt", value: m.signups, href: href.signups, sub: sub(pctOf(m.signups, m.clicks), "tıklama") },
    { label: "Ödeyen (deneme → ödeme)", value: m.payers, href: href.payers, sub: sub(pctOf(m.payers, m.signups), "kayıt") },
    { label: "Ödül (ödenen talep)", value: paidClaims, href: href.rewards, sub: sub(pctOf(paidClaims, m.payers), "ödeyen") },
  ];
}

export type KFactorParts = { invites: number | null; conversion: number | null; k: number | null; selfSustaining: boolean };

export function kFactorParts(m: GrowthMetrics): KFactorParts {
  return {
    invites: m.invitesPerReferrer,
    conversion: m.signupToPaid,
    k: m.kFactor,
    selfSustaining: m.kFactor != null && m.kFactor >= 1,
  };
}

export function readinessSummary(groups: readonly (readonly ReadinessCheck[])[]): { ok: number; total: number; blocking: number } {
  let ok = 0;
  let total = 0;
  let blocking = 0;
  for (const g of groups) {
    for (const c of g) {
      total += 1;
      if (c.ok) ok += 1;
      else if (c.blocking) blocking += 1;
    }
  }
  return { ok, total, blocking };
}

/** Program tamamen kapalı mı (bayrak kapalı ve etkin kural yok) -> dürüst boş durum. */
export function growthIsIdle(flags: { referralEnabled: boolean; partnerEnabled: boolean }, activeRules: number): boolean {
  return !flags.referralEnabled && !flags.partnerEnabled && activeRules === 0;
}
