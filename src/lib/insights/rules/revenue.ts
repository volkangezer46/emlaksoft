import { buildDedupeKey, monthPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { capPerUser, dayMs, MAX_PER_RECIPIENT_PER_RULE, nameOr } from "@/lib/insights/rules/common";
import { PRICE_MIN_PEERS } from "@/lib/insights/rules/price-action";
import { anniversaryKey, RESALE_WINDOW_DAYS, RESALE_YEARS } from "@/lib/insights/rules/lifecycle";

/**
 * GELİR FIRSATI kuralları (SAF, kanıtlı, href'li; hiçbir kaydı değiştirmez). Hepsi "veri yoksa kart yok" ilkesine uyar.
 *
 *  authority_renewal@1  Yetki belgesi bitmesine 16-30 gün kaldı: yenileme görüşmesi (0-15 gün `deadline@1` kuralında).
 *  unshown_match@1      Güçlü eşleşme (talep × portföy) var ama bu çift için hiç randevu/gösterim yok.
 *  home_value@1         1+ yıl önce ofisten ev almış müşteri; YALNIZ emsal motoru orta/yüksek güven verirse güncel değer
 *                       aralığı (TAHMİN) ile yeni portföy/yeniden satış görüşmesi. 3. ve 5. yıl ±15 gün `lifecycle@1`'de.
 *  price_revision@1     60+ gündür yayında, fiyatı değişmemiş, 60 gündür randevu yok VE emsal var: fiyat revizyonu.
 *                       `price_action@1` ile AYNI dedupe anahtarını kullanır (aynı ilan için çift kart çıkmaz).
 *  referral_invite@1    Anketi 9-10 puanlayıp tavsiye programında olmayan memnun müşteri: tavsiye daveti.
 *
 * Kira bitişine 90 gün kala kiracı fırsatı `lifecycle@1` içindedir (0-90 gün, kiracıdan alıcıya dönüştürme).
 */

export const AUTHORITY_RENEWAL_RULE_ID = "authority_renewal@1";
export const UNSHOWN_MATCH_RULE_ID = "unshown_match@1";
export const HOME_VALUE_RULE_ID = "home_value@1";
export const PRICE_REVISION_RULE_ID = "price_revision@1";
export const REFERRAL_INVITE_RULE_ID = "referral_invite@1";

export const AUTHORITY_RENEWAL_MIN_DAYS = 16;
export const AUTHORITY_RENEWAL_MAX_DAYS = 30;
export const UNSHOWN_MATCH_MIN_SCORE = 75;
/** Çift en az bu kadar gündür ortadaysa "gösterim yok" sayılır (taze çifte süre tanınır). */
export const UNSHOWN_MATCH_MIN_AGE_DAYS = 3;
export const HOME_VALUE_MIN_YEARS = 1;
export const PRICE_REVISION_MIN_DAYS = 60;
export const REFERRAL_MIN_SCORE = 9;

const money = (n: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Math.round(n))} TL`;

/* ------------------------------ (a) yetki yenileme ------------------------------ */

export type AuthorityRenewalFact = {
  propertyId: string;
  assignedTo: string;
  label: string | null;
  endDate: string;
  daysLeft: number;
  listPrice: number | null;
  commissionRate: number | null;
};

export function evaluateAuthorityRenewal(facts: readonly AuthorityRenewalFact[], nowMs: number): InsightDraft[] {
  const drafts: (InsightDraft & { _left: number })[] = [];
  for (const f of facts) {
    if (!f.assignedTo) continue;
    if (f.daysLeft < AUTHORITY_RENEWAL_MIN_DAYS || f.daysLeft > AUTHORITY_RENEWAL_MAX_DAYS) continue;
    const name = nameOr(f.label, "İlan");
    const atRisk = f.listPrice && f.commissionRate && f.listPrice > 0 && f.commissionRate > 0 ? (f.listPrice * f.commissionRate) / 100 : null;
    drafts.push({
      kind: "deadline",
      ruleId: AUTHORITY_RENEWAL_RULE_ID,
      severity: "bilgi",
      title: `Yetki yenileme zamanı (${f.daysLeft} gün): ${name}`,
      why:
        "Yetki belgesi bitmeden mal sahibiyle yenileme görüşmesi yapılırsa portföy ve komisyon ofiste kalır; süre dolunca ilan yetkisiz kalır ve başka ofise geçebilir.",
      evidence: [
        { label: "Bitiş", value: f.endDate },
        { label: "Kalan", value: `${f.daysLeft} gün` },
        ...(atRisk ? [{ label: "Risk altındaki komisyon (liste fiyatı × oran)", value: money(atRisk) }] : []),
      ],
      href: `/app/portfoyler/${f.propertyId}`,
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("auth-renew", f.propertyId, f.endDate),
      validUntilMs: nowMs + dayMs(Math.max(1, f.daysLeft - AUTHORITY_RENEWAL_MIN_DAYS + 1)),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: f.daysLeft,
      impact: atRisk ? Math.min(10, Math.max(3, Math.round(Math.log10(atRisk)))) : 3,
      _left: f.daysLeft,
    });
  }
  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => a._left - b._left).map(({ _left, ...d }) => {
    void _left;
    return d;
  });
}

/* ------------------------------ (b) gösterimsiz eşleşme ------------------------------ */

export type UnshownMatchFact = {
  demandId: string;
  propertyId: string;
  customerName: string | null;
  propertyLabel: string | null;
  assignedTo: string;
  score: number;
  /** Çiftin ortaya çıkışından (talep/portföyden sonra olanı) bu yana gün. */
  pairAgeDays: number;
  /** Bu müşteri × portföy için herhangi bir (iptal olmayan) randevu var mı. */
  hasAppointment: boolean;
};

export function evaluateUnshownMatches(facts: readonly UnshownMatchFact[], nowMs: number): InsightDraft[] {
  const month = monthPeriod(nowMs);
  const drafts: (InsightDraft & { _score: number })[] = [];
  for (const f of facts) {
    if (!f.assignedTo || f.hasAppointment) continue;
    if (f.score < UNSHOWN_MATCH_MIN_SCORE || f.pairAgeDays < UNSHOWN_MATCH_MIN_AGE_DAYS) continue;
    const who = nameOr(f.customerName, "Müşteri");
    const prop = nameOr(f.propertyLabel, "portföy");
    drafts.push({
      kind: "match_suggestion",
      ruleId: UNSHOWN_MATCH_RULE_ID,
      severity: f.score >= 90 ? "orta" : "bilgi",
      title: `Güçlü eşleşme, gösterim yok: ${who} × ${prop}`,
      why: `Talep ile portföy %${Math.round(f.score)} uyumlu ve ${f.pairAgeDays} gündür ortada, ama bu müşteri için bu portföyde randevu/gösterim yok. Müşteriye bildirip randevu önerin.`,
      evidence: [
        { label: "Uyum", value: `%${Math.round(f.score)}` },
        { label: "Çift yaşı", value: `${f.pairAgeDays} gün` },
        { label: "Randevu", value: "yok" },
      ],
      href: `/app/talepler?sekme=eslesme&demand=${f.demandId}&property=${f.propertyId}`,
      entityType: "customer_demand",
      entityId: f.demandId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("unshown", `${f.demandId}-${f.propertyId.slice(0, 8)}`, month),
      validUntilMs: nowMs + dayMs(14),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: Math.min(10, Math.round(f.score / 10)),
      _score: f.score,
    });
  }
  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._score - a._score).map(({ _score, ...d }) => {
    void _score;
    return d;
  });
}

/* ------------------------------ (d) evinizin güncel değeri ------------------------------ */

export type HomeValueFact = {
  dealId: string;
  customerId: string;
  customerName: string | null;
  propertyLabel: string | null;
  assignedTo: string;
  /** Alım (kapanış) günü "YYYY-AA-GG". */
  boughtAt: string;
  /** Emsal motoru aralığı (yuvarlanmış). Emsal yoksa fact hiç üretilmez. */
  low: number;
  high: number;
  compCount: number;
  confidence: "yüksek" | "orta";
};

const dayKeyOf = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (fromKey: string, toKey: string) => Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);

/** Alım yıldönümü 3. / 5. yıl penceresinde mi (orada `lifecycle@1` zaten kart üretir). */
export function inLifecycleWindow(boughtAt: string, todayKey: string): boolean {
  return RESALE_YEARS.some((y) => Math.abs(daysBetween(todayKey, anniversaryKey(boughtAt, y))) <= RESALE_WINDOW_DAYS);
}

export function evaluateHomeValue(facts: readonly HomeValueFact[], nowMs: number): InsightDraft[] {
  const today = dayKeyOf(nowMs);
  const month = monthPeriod(nowMs);
  const drafts: (InsightDraft & { _years: number })[] = [];
  for (const f of facts) {
    if (!f.assignedTo) continue;
    if (!(f.low > 0) || !(f.high >= f.low) || f.compCount < 3) continue;
    const days = daysBetween(f.boughtAt.slice(0, 10), today);
    const years = Math.floor(days / 365);
    if (years < HOME_VALUE_MIN_YEARS) continue;
    if (inLifecycleWindow(f.boughtAt.slice(0, 10), today)) continue;
    const name = nameOr(f.customerName, "Müşteri");
    drafts.push({
      kind: "match_suggestion",
      ruleId: HOME_VALUE_RULE_ID,
      severity: "bilgi",
      title: `Evinin güncel değerini paylaş: ${name}`,
      why:
        `${name} ${years} yıl önce ofisinizden ev aldı. Bölgedeki kapanan satış ve aktif ilan emsalleri güncel bir değer aralığı veriyor; ` +
        "değeri paylaşmak yeni portföy veya yeniden satış görüşmesi için doğal bir giriş olur. Bu bir TAHMİNDİR, ekspertiz değildir.",
      evidence: [
        { label: "Alım", value: f.boughtAt.slice(0, 10) },
        { label: "Tahmini değer aralığı", value: `${money(f.low)} – ${money(f.high)}` },
        { label: "Emsal", value: `${f.compCount} kayıt (${f.confidence} güven)` },
        { label: "Kaynak", value: "ofisin kapanan satışları + aktif ilanlar" },
      ],
      href: `/app/musteriler/${f.customerId}`,
      entityType: "customer",
      entityId: f.customerId,
      isForecast: true,
      confidence: f.confidence === "yüksek" ? "yuksek" : "orta",
      dedupeKey: buildDedupeKey("home-value", f.dealId, month),
      validUntilMs: nowMs + dayMs(30),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: 3,
      _years: years,
    });
  }
  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._years - a._years).map(({ _years, ...d }) => {
    void _years;
    return d;
  });
}

/* ------------------------------ (e) fiyat revizyonu ------------------------------ */

export type PriceRevisionFact = {
  propertyId: string;
  assignedTo: string;
  label: string | null;
  listPrice: number;
  daysListed: number;
  /** Son fiyat değişikliğinden bu yana gün; son 60 günde değişiklik yoksa null (60+ gündür sabit). */
  daysSincePriceChange: number | null;
  /** Son 60 günde bu portföyde (iptal olmayan) randevu sayısı. */
  appointmentsLast60: number;
  peerCount: number;
  peerMedian: number | null;
};

export function evaluatePriceRevision(facts: readonly PriceRevisionFact[], nowMs: number): InsightDraft[] {
  const month = monthPeriod(nowMs);
  const drafts: (InsightDraft & { _days: number })[] = [];
  for (const f of facts) {
    if (!f.assignedTo || f.daysListed < PRICE_REVISION_MIN_DAYS) continue;
    if (f.daysSincePriceChange !== null && f.daysSincePriceChange < PRICE_REVISION_MIN_DAYS) continue;
    if (f.appointmentsLast60 > 0) continue;
    // Emsal yoksa fiyat önerisi yok.
    if (f.peerMedian === null || !(f.peerMedian > 0) || f.peerCount < PRICE_MIN_PEERS || !(f.listPrice > 0)) continue;
    const abovePct = Math.round(((f.listPrice - f.peerMedian) / f.peerMedian) * 100);
    // Medyanın altındaki ilanda sorun fiyat değildir.
    if (abovePct < 0) continue;
    const name = nameOr(f.label, "İlan");
    drafts.push({
      kind: "price_action",
      ruleId: PRICE_REVISION_RULE_ID,
      severity: abovePct >= 15 ? "orta" : "bilgi",
      title: `İlgi yok, fiyatı gözden geçir: ${name}`,
      why:
        `${f.daysListed} gündür yayında, fiyat ${PRICE_REVISION_MIN_DAYS}+ gündür değişmedi ve son ${PRICE_REVISION_MIN_DAYS} günde randevu yok. ` +
        `Liste fiyatı benzer ${f.peerCount} aktif ilanın medyanının ${abovePct === 0 ? "düzeyinde" : `%${abovePct} üzerinde`}. Karşılaştırma istenen fiyatlardır (gerçekleşen satış değil).`,
      evidence: [
        { label: "Yayında", value: `${f.daysListed} gün` },
        { label: "Fiyat değişimi", value: `${PRICE_REVISION_MIN_DAYS}+ gündür yok` },
        { label: "Randevu (60 gün)", value: "0" },
        { label: "Emsal medyanı", value: money(f.peerMedian) },
        { label: "Liste fiyatı", value: money(f.listPrice) },
      ],
      href: `/app/portfoyler/${f.propertyId}`,
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: f.peerCount >= 10 ? "orta" : "dusuk",
      // price_action@1 ile aynı anahtar: aynı ilan aynı ay için tek kart (önce gelen kalır).
      dedupeKey: buildDedupeKey("price", f.propertyId, month),
      validUntilMs: nowMs + dayMs(14),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: Math.min(10, Math.max(2, Math.round((abovePct + f.daysListed / 10) / 5))),
      _days: f.daysListed,
    });
  }
  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._days - a._days).map(({ _days, ...d }) => {
    void _days;
    return d;
  });
}

/* ------------------------------ (f) tavsiye daveti ------------------------------ */

export type ReferralInviteFact = {
  customerId: string;
  customerName: string | null;
  assignedTo: string;
  score: number;
  answeredAt: string;
  /** Müşterinin (aktif/pasif) tavsiye bağlantısı var mı. */
  hasReferralLink: boolean;
};

export function evaluateReferralInvites(facts: readonly ReferralInviteFact[], nowMs: number): InsightDraft[] {
  const month = monthPeriod(nowMs);
  const drafts: (InsightDraft & { _score: number })[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    if (!f.assignedTo || f.hasReferralLink || f.score < REFERRAL_MIN_SCORE) continue;
    if (seen.has(f.customerId)) continue;
    seen.add(f.customerId);
    const name = nameOr(f.customerName, "Müşteri");
    drafts.push({
      kind: "match_suggestion",
      ruleId: REFERRAL_INVITE_RULE_ID,
      severity: "bilgi",
      title: `Memnun müşteri, tavsiye daveti gönder: ${name}`,
      why: `${name} anketinde ${f.score}/10 puan verdi ve tavsiye programında yok. Memnun müşteri en ucuz yeni müşteri kaynağıdır: kişiye özel tavsiye bağlantısı oluşturup paylaşın.`,
      evidence: [
        { label: "Anket puanı", value: `${f.score}/10` },
        { label: "Anket tarihi", value: f.answeredAt.slice(0, 10) },
        { label: "Tavsiye bağlantısı", value: "yok" },
      ],
      href: "/app/tavsiyeler",
      entityType: "customer",
      entityId: f.customerId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("referral-invite", f.customerId, month),
      validUntilMs: nowMs + dayMs(30),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: 2,
      _score: f.score,
    });
  }
  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._score - a._score).map(({ _score, ...d }) => {
    void _score;
    return d;
  });
}
