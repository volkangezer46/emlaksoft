import type { PlanDef } from "@/lib/billing/plans";
import { trialCtaLabel, trialShort, yearlyOffer } from "@/lib/marketing-copy";

/**
 * Metin değişkenleri ({deneme}, {yillik} ...): deneme günü ve yıllık teklif tek kaynaktan (admin paket tanımları) gelir;
 * editörde sabit gün/oran yazılmaz. Saf modül.
 */
export type TokenContext = { trialDays?: number; plans: readonly PlanDef[] };

const TOKEN_RE = /\{([a-z_]+)\}/g;

/**
 * Paket başına aylık EmlakFiyati sorgu (kontör) hakkı: sayı KODA SABİTLENMEZ; plan tanımındaki `efCreditsMonthly` alanından
 * gelir. Alan henüz yoksa veya hiçbir pakette >0 değilse null (değişkenli satır gizlenir).
 */
export function efMonthlyAllowanceText(plans: readonly PlanDef[]): string | null {
  const parts: string[] = [];
  for (const p of plans) {
    const n = (p as unknown as { efCreditsMonthly?: unknown }).efCreditsMonthly;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) parts.push(`${p.name} ${n}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function tokenValue(name: string, ctx: TokenContext): string | null | undefined {
  const offer = yearlyOffer(ctx.plans);
  switch (name) {
    case "deneme":
      return trialShort(ctx.trialDays);
    case "deneme_dene":
      return trialCtaLabel(ctx.trialDays);
    case "deneme_gun":
      return ctx.trialDays ? `${ctx.trialDays} gün ` : "";
    case "deneme_uzun":
      return ctx.trialDays ? `${ctx.trialDays} gün ücretsiz` : "Ücretsiz deneme";
    case "ef_hak":
      return efMonthlyAllowanceText(ctx.plans);
    case "yillik":
      return offer ? offer.label : null;
    case "yillik_cumle":
      return offer ? `Yıllık ödemede ${offer.label}.` : "";
    case "yillik_metin":
      return offer ? `Yıllık ödemede ${offer.label} (${offer.gift} ay hediye).` : "Yıllık ödeme seçeneği ve avantajı fiyat bölümünde paket paket yazar.";
    default:
      return undefined;
  }
}

/** Değişkenleri çözer. `missing`: değeri şu an olmayan değişken var (ör. yıllık teklif yok) -> madde gizlenir. */
export function resolveTokens(value: string, ctx: TokenContext): { text: string; missing: boolean } {
  let missing = false;
  const text = value.replace(TOKEN_RE, (whole, name: string) => {
    const v = tokenValue(name, ctx);
    if (v === undefined) return whole;
    if (v === null) {
      missing = true;
      return "";
    }
    return v;
  });
  return { text: text.trim(), missing };
}

export function tx(value: string, ctx: TokenContext): string {
  return resolveTokens(value, ctx).text;
}
