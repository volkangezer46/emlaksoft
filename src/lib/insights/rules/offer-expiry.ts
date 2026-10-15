import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { MAX_PER_RECIPIENT_PER_RULE, capPerUser, dayMs, liveIdsOf, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: offer_expiry@1 — yanıt bekleyen teklifin geçerliliği (offers.valid_until) 0–3 gün içinde DOLUYOR.
 *
 * Kapsam: durumu `OFFER_REMINDER_STATUSES` (taslak / gönderildi / karşı teklif) olan teklifler; olgu yükleyicisi süzer.
 * Alıcı: teklifi açan danışman (offers.created_by); yoksa yönetim. Günlük cron hatırlatmasından (2 gün kala bildirim)
 * farkı: kart, geçerlilik penceresi boyunca ana ekranda durur ve teklif sonuçlanınca/tarih uzatılınca kendiliğinden kapanır.
 */

export const OFFER_EXPIRY_RULE_ID = "offer_expiry@1";
/** Pencere: bugün (0) … {@link OFFER_EXPIRY_WINDOW_DAYS} gün sonrası. */
export const OFFER_EXPIRY_WINDOW_DAYS = 3;
export const OFFER_EXPIRY_MAX_PER_USER = MAX_PER_RECIPIENT_PER_RULE;

export type OfferExpiryFact = {
  offerId: string;
  propertyCode: string | null;
  customerName: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  /** "YYYY-AA-GG". */
  validUntil: string;
  /** Bitişe kalan gün (bugün = 0). */
  daysLeft: number;
  /** Teklifi açan danışman; yoksa null (yönetime gider). */
  advisorId: string | null;
};

const STATUS_LABEL: Record<string, string> = { draft: "taslak", submitted: "yanıt bekliyor", countered: "karşı teklif" };

function formatAmount(amount: number | null, currency: string | null): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const n = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(amount);
  return !currency || currency === "TRY" ? `${n} ₺` : `${n} ${currency}`;
}

export function evaluateOfferExpiryRun(facts: readonly OfferExpiryFact[], nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.offerId || !f.validUntil) continue;
    if (f.daysLeft < 0 || f.daysLeft > OFFER_EXPIRY_WINDOW_DAYS) continue;
    const what = [nameOr(f.propertyCode, ""), nameOr(f.customerName, "")].filter(Boolean).join(" · ") || "teklif";
    const title =
      f.daysLeft === 0 ? `Teklifin geçerliliği bugün doluyor: ${what}` : `Teklifin geçerliliği ${f.daysLeft} gün içinde doluyor: ${what}`;
    const amount = formatAmount(f.amount, f.currency);
    drafts.push({
      kind: "deadline",
      ruleId: OFFER_EXPIRY_RULE_ID,
      severity: f.daysLeft <= 1 ? "yuksek" : "orta",
      title,
      why: "Geçerlilik süresi dolan teklif karşı tarafı bağlamaz. Süre dolmadan yanıtı alın, gerekirse geçerlilik tarihini güncelleyin ya da teklifi sonuçlandırın.",
      evidence: [
        { label: "Geçerlilik", value: f.validUntil },
        { label: "Kalan süre", value: f.daysLeft === 0 ? "bugün" : `${f.daysLeft} gün` },
        { label: "Durum", value: STATUS_LABEL[f.status] ?? f.status },
        ...(amount ? [{ label: "Tutar", value: amount }] : []),
      ],
      href: `/app/teklifler/${f.offerId}`,
      entityType: "offer",
      entityId: f.offerId,
      isForecast: false,
      confidence: null,
      // Dönem = geçerlilik tarihi: tarih uzatılınca yeni anahtar; aynı tarih için tekrar kart yok.
      dedupeKey: buildDedupeKey("offer-expiry", f.offerId, f.validUntil),
      validUntilMs: nowMs + dayMs(f.daysLeft + 1),
      audience: f.advisorId ? { type: "user", userId: f.advisorId } : { type: "management" },
      urgencyDays: f.daysLeft,
      impact: 3,
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  const byUrgency = (a: InsightDraft, b: InsightDraft) => (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0);
  // capPerUser yönetim taslaklarını sınırlamaz; aynı tavanı yönetime de uygula.
  const capped = capPerUser(drafts, OFFER_EXPIRY_MAX_PER_USER, byUrgency);
  const management = capped.filter((d) => d.audience.type === "management").sort(byUrgency).slice(0, OFFER_EXPIRY_MAX_PER_USER);
  return { drafts: [...management, ...capped.filter((d) => d.audience.type !== "management")], liveEntityIds };
}

export function evaluateOfferExpiry(facts: readonly OfferExpiryFact[], nowMs: number): InsightDraft[] {
  return evaluateOfferExpiryRun(facts, nowMs).drafts;
}
