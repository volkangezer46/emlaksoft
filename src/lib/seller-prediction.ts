/**
 * Satıcı-tahmini (seller prediction): bir malik-tipi müşterinin YAKINDA portföy
 * listeleyeceği (satış/kiralık verme) olasılığını mevcut CRM sinyallerinden
 * heuristik olarak skorlar. Amaç, danışmana "şimdi hangi maliki ara" önceliği
 * vermek — ABD CRM'lerindeki "seller prediction for past clients" mantığının
 * Türk pazarına uyarlanmış, şema değişikliği gerektirmeyen sürümü.
 *
 * Saf/deterministik. Kesin bir kehanet değil, bir öncelik sinyalidir.
 */

export type SellerSignals = {
  /** customer_types "malik/mülk sahibi/owner" içeriyor mu — birincil kapı. */
  isOwnerType: boolean;
  /** Son temastan bu yana gün (null = hiç temas yok). */
  daysSinceContact: number | null;
  /** İlişki süresi (müşteri kaydından bu yana gün). */
  tenureDays: number;
  /** Geçmiş kazanılmış anlaşma sayısı — kanıtlı işlem eğilimi. */
  pastWonDeals: number;
  /** Açık "satış/listeleme" niyeti taşıyan talep var mı (varsa en güçlü sinyal). */
  hasListingIntentDemand: boolean;
};

export type SellerPrediction = {
  score: number; // 0..100
  tier: "high" | "medium" | "low";
  label: string;
  reasons: string[]; // neden bu skor
};

/**
 * Temas dormancy'sinin "olgunluk penceresi": çok yeni temas (henüz sıcak,
 * yeni listelemez) ve çok eski (ilişki kopmuş) düşük; 60–180 gün arası zirve —
 * ilişki taze ama yeni bir hamle için olgun.
 */
function dormancyPoints(days: number | null): { pts: number; reason: string | null } {
  if (days == null) return { pts: 0, reason: null };
  if (days < 30) return { pts: 4, reason: null };
  if (days <= 90) return { pts: 26, reason: "Temas olgunluk penceresinde (30–90 gün)" };
  if (days <= 180) return { pts: 22, reason: "Yeniden temas için ideal aralık (90–180 gün)" };
  if (days <= 365) return { pts: 12, reason: "Uzun süredir sessiz — yeniden ısıtın" };
  return { pts: 4, reason: "İlişki soğumuş (1+ yıl)" };
}

export function scoreSellerLikelihood(s: SellerSignals): SellerPrediction {
  const reasons: string[] = [];
  let score = 0;

  if (s.isOwnerType) {
    score += 22;
    reasons.push("Mülk sahibi profili");
  }

  if (s.hasListingIntentDemand) {
    score += 34;
    reasons.push("Açık satış/listeleme talebi");
  }

  const d = dormancyPoints(s.daysSinceContact);
  score += d.pts;
  if (d.reason) reasons.push(d.reason);

  // Kanıtlı işlem geçmişi — tekrar iş yapma eğilimi
  const dealPts = Math.min(18, s.pastWonDeals * 9);
  if (dealPts > 0) {
    score += dealPts;
    reasons.push(s.pastWonDeals > 1 ? `${s.pastWonDeals} geçmiş anlaşma` : "Geçmiş anlaşma var");
  }

  // Köklü ilişki (1+ yıl) hafif güven ekler
  if (s.tenureDays >= 365) {
    score += 8;
    reasons.push("Köklü ilişki (1+ yıl)");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier: SellerPrediction["tier"] = score >= 62 ? "high" : score >= 34 ? "medium" : "low";
  const label = tier === "high" ? "Yüksek olasılık" : tier === "medium" ? "Orta olasılık" : "Düşük olasılık";
  if (reasons.length === 0) reasons.push("Belirgin sinyal yok");
  return { score, tier, label, reasons };
}

/** customer_types dizisinden malik olup olmadığını çıkarır. */
export function isOwnerCustomer(types: string[] | null | undefined): boolean {
  return (types ?? []).some((t) => /malik|mülk|owner|sahib/i.test(t));
}

/** Talep listesinden satış/listeleme niyeti taşıyan açık talep var mı. */
export function hasListingIntent(
  demands: { status?: string | null; demand_type?: string | null; transaction_type?: string | null }[] | null | undefined,
): boolean {
  return (demands ?? []).some((d) => {
    const open = d.status == null || ["new", "active", "matched"].includes(d.status);
    const sell = /sat|list|devren/i.test(`${d.demand_type ?? ""} ${d.transaction_type ?? ""}`);
    return open && sell;
  });
}
