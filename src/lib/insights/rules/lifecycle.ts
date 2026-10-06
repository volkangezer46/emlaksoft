import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { capPerUser, dayMs, MAX_PER_RECIPIENT_PER_RULE, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: lifecycle — satış sonrası ve yeniden satış fırsatları (SAF). Kanıtlı, kayıt adlı, href'li; hiçbir kaydı
 * değiştirmez (görev "Görev olarak kabul et" ile kullanıcı onayıyla oluşur).
 *
 *  1) Yeniden satış yıldönümü: ofisten ev alan müşterinin alımının 3. veya 5. yılı ±15 gün içinde → değer/yeniden satış
 *     görüşmesi önerisi. Kapanış tarihi = ilk komisyon kaydı (yoksa anlaşmanın son güncellemesi; kanıtta yazılır).
 *  2) Kiracı sözleşmesi bitiyor (0-90 gün): kira yenileme + kiracıyı alıcıya dönüştürme (çapraz satış) görüşmesi.
 *  3) Evini sattı (son 60 gün) ve açık arayışı yok: satıcıya yeni ev arayışı sorulsun (çapraz satış).
 * Örnek veri olgu yükleyicisinde elenir; veri yoksa içgörü yok.
 */

export const LIFECYCLE_RULE_ID = "lifecycle@1";
export const RESALE_YEARS = [3, 5] as const;
export const RESALE_WINDOW_DAYS = 15;
export const LEASE_END_WINDOW_DAYS = 90;
export const SELLER_RECENT_DAYS = 60;

export type ResaleFact = {
  dealId: string;
  customerId: string;
  customerName: string | null;
  propertyLabel: string | null;
  assignedTo: string;
  closedAt: string;
  closedAtSource: "commission" | "deal_update";
};

export type LeaseEndFact = {
  rentalId: string;
  renterName: string | null;
  propertyLabel: string | null;
  assignedTo: string;
  endDate: string;
  hasOpenBuyDemand: boolean;
};

export type SellerFact = {
  customerId: string;
  customerName: string | null;
  propertyLabel: string | null;
  assignedTo: string;
  soldAt: string;
  hasOpenDemand: boolean;
};

export type LifecycleFacts = { resale: ResaleFact[]; leaseEnd: LeaseEndFact[]; sellers: SellerFact[] };

const dayKeyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Kapanıştan `years` yıl sonrasının gün anahtarı (29 Şubat → 28 Şubat). */
export function anniversaryKey(closedIso: string, years: number): string {
  const d = closedIso.slice(0, 10);
  const y = Number(d.slice(0, 4)) + years;
  const md = d.slice(5) === "02-29" ? "02-28" : d.slice(5);
  return `${y}-${md}`;
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export function evaluateLifecycle(facts: LifecycleFacts, nowMs: number): InsightDraft[] {
  const today = dayKeyOf(nowMs + 3 * 3_600_000);
  const drafts: (InsightDraft & { _rank: number })[] = [];

  for (const f of facts.resale) {
    if (!f.assignedTo) continue;
    for (const years of RESALE_YEARS) {
      const ann = anniversaryKey(f.closedAt, years);
      const diff = daysBetween(today, ann);
      if (Math.abs(diff) > RESALE_WINDOW_DAYS) continue;
      const name = nameOr(f.customerName, "Müşteri");
      drafts.push({
        kind: "match_suggestion",
        ruleId: LIFECYCLE_RULE_ID,
        severity: "bilgi",
        title: `Alımının ${years}. yılı: ${name}`,
        why:
          `${name}, ${f.propertyLabel ? `"${nameOr(f.propertyLabel, "portföy")}" ` : ""}alımını ${years} yıl önce ofisinizle yaptı. ` +
          "Güncel değer bilgisi ve yeniden satış/yatırım planı için kısa bir görüşme iyi bir zamanlama olabilir.",
        evidence: [
          { label: "Kapanış", value: f.closedAt.slice(0, 10) },
          { label: "Kaynak", value: f.closedAtSource === "commission" ? "ilk komisyon kaydı" : "anlaşmanın son güncellemesi" },
          { label: "Yıldönümü", value: ann },
        ],
        href: `/app/musteriler/${f.customerId}`,
        entityType: "customer",
        entityId: f.customerId,
        isForecast: false,
        confidence: null,
        dedupeKey: buildDedupeKey("lifecycle-resale", f.dealId, `${years}y`),
        validUntilMs: nowMs + dayMs(RESALE_WINDOW_DAYS * 2),
        audience: { type: "user", userId: f.assignedTo },
        urgencyDays: Math.max(0, diff),
        impact: years === 5 ? 4 : 3,
        _rank: Math.abs(diff),
      });
    }
  }

  for (const f of facts.leaseEnd) {
    if (!f.assignedTo) continue;
    const left = daysBetween(today, f.endDate.slice(0, 10));
    if (left < 0 || left > LEASE_END_WINDOW_DAYS) continue;
    const name = nameOr(f.renterName, "Kiracı");
    drafts.push({
      kind: "match_suggestion",
      ruleId: LIFECYCLE_RULE_ID,
      severity: left <= 30 ? "orta" : "bilgi",
      title: `Kira sözleşmesi ${left} gün sonra bitiyor: ${name}`,
      why:
        "Kiracının yeni ev ihtiyacı doğabilir: yenileme görüşmesiyle birlikte satın alma (kiracıdan alıcıya) seçeneğini konuşun." +
        (f.hasOpenBuyDemand ? " Müşterinin açık bir arayış kaydı zaten var." : " Açık arayış kaydı yok; ihtiyaç varsa talep açın."),
      evidence: [
        { label: "Bitiş", value: f.endDate.slice(0, 10) },
        { label: "Kalan", value: `${left} gün` },
        ...(f.propertyLabel ? [{ label: "Portföy", value: nameOr(f.propertyLabel, "portföy") }] : []),
      ],
      href: `/app/kiralama/${f.rentalId}`,
      entityType: "rental",
      entityId: f.rentalId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("lifecycle-lease", f.rentalId, f.endDate.slice(0, 10)),
      validUntilMs: nowMs + dayMs(Math.max(1, left + 1)),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: left,
      impact: 3,
      _rank: left,
    });
  }

  for (const f of facts.sellers) {
    if (!f.assignedTo || f.hasOpenDemand) continue;
    const ago = daysBetween(f.soldAt.slice(0, 10), today);
    if (ago < 0 || ago > SELLER_RECENT_DAYS) continue;
    const name = nameOr(f.customerName, "Malik");
    drafts.push({
      kind: "match_suggestion",
      ruleId: LIFECYCLE_RULE_ID,
      severity: "bilgi",
      title: `Evini sattı, yeni ev arıyor olabilir: ${name}`,
      why: `${name} portföyünü ${ago} gün önce sizinle sattı ve kayıtlı açık arayışı yok. Yeni ev (alım/kiralama) ihtiyacını sorun.`,
      evidence: [
        { label: "Satış", value: f.soldAt.slice(0, 10) },
        ...(f.propertyLabel ? [{ label: "Satılan", value: nameOr(f.propertyLabel, "portföy") }] : []),
        { label: "Açık arayış", value: "yok" },
      ],
      href: `/app/musteriler/${f.customerId}`,
      entityType: "customer",
      entityId: f.customerId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("lifecycle-seller", f.customerId, f.soldAt.slice(0, 10)),
      validUntilMs: nowMs + dayMs(30),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: 3,
      _rank: ago,
    });
  }

  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => a._rank - b._rank).map(({ _rank, ...d }) => {
    void _rank;
    return d;
  });
}
