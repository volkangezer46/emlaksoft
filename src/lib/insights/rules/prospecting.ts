import { DAY_MS } from "@/lib/clock";
import { buildDedupeKey, dayPeriod, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { dayMs, gunText, liveIdsOf, nameOr } from "@/lib/insights/rules/common";
import {
  AGING_DAYS,
  AGING_NO_CONTACT_DAYS,
  CLAIM_WARN_DAYS,
  PRICE_DROP_WINDOW_DAYS,
  UNCALLED_HIGH_DAYS,
  UNCALLED_MIN_DAYS,
} from "@/lib/prospecting/thresholds";

/**
 * Sahibinden ilanlar (portföy avı) içgörü kuralları — SAF. Olgular `prospecting-facts.ts`'ten gelir.
 * Kurallar: veri yoksa kart yok; kanıt satırında telefon/ad YOK; her kartın `href`'i filtrelenmiş hedeftir; örnek veri
 * (is_sample) olgu yükleyicide elenir. Kart türü mevcut `call_priority` (insights.kind kapalı liste: yeni tür gerekmez).
 * Arama sonucu kaydedilince koşul kalkar ve kart bir sonraki motor turunda kapanır (liveEntityIds).
 */

export const FSBO_UNCALLED_RULE_ID = "fsbo_uncalled@1";
export const FSBO_FOLLOWUP_RULE_ID = "fsbo_followup_due@1";
export const FSBO_PRICE_DROP_RULE_ID = "fsbo_price_drop@1";
export const FSBO_RELISTED_RULE_ID = "fsbo_relisted@1";
export const FSBO_AGING_RULE_ID = "fsbo_aging@1";
export const FSBO_CLAIM_RULE_ID = "fsbo_claim_expiring@1";

const BASE = "/app/portfoy-avi";

export type FsboFact = {
  id: string;
  assignedTo: string | null;
  assigneeName: string | null;
  status: string;
  contactAttempts: number;
  firstSeenMs: number;
  /** Portalın ilan tarihi (varsa "ilan yaşı" bunu kullanır). */
  listedAtMs: number | null;
  lastContactMs: number | null;
  nextActionMs: number | null;
  lastPriceDropMs: number | null;
  lastPriceDropPct: number | null;
  relistOf: string | null;
  createdMs: number;
  claimExpiresMs: number | null;
  districtName: string | null;
  rooms: string | null;
};

const OPEN = new Set(["yeni", "arandi", "randevu", "yetki_alindi"]);
const days = (fromMs: number, nowMs: number): number => Math.max(0, Math.floor((nowMs - fromMs) / DAY_MS));

function group(facts: readonly FsboFact[], pick: (f: FsboFact) => boolean): Map<string, FsboFact[]> {
  const out = new Map<string, FsboFact[]>();
  for (const f of facts) {
    if (!f.assignedTo || !pick(f)) continue;
    const list = out.get(f.assignedTo) ?? [];
    list.push(f);
    out.set(f.assignedTo, list);
  }
  return out;
}

function place(f: Pick<FsboFact, "districtName" | "rooms">): string {
  return [nameOr(f.districtName, ""), (f.rooms ?? "").trim()].filter(Boolean).join(" ") || "Sahibinden";
}

/** Kayıttan beri hiç aranmayan yeni ilanlar (danışman başına tek kart). */
export function evaluateFsboUncalled(facts: readonly FsboFact[], nowMs: number): InsightRuleRun {
  const week = weekPeriod(nowMs);
  const drafts: InsightDraft[] = [];
  for (const [userId, list] of group(facts, (f) => f.status === "yeni" && f.contactAttempts === 0 && nowMs - f.firstSeenMs >= UNCALLED_MIN_DAYS * DAY_MS)) {
    const oldest = Math.max(...list.map((f) => days(f.firstSeenMs, nowMs)));
    drafts.push({
      kind: "call_priority",
      ruleId: FSBO_UNCALLED_RULE_ID,
      severity: oldest >= UNCALLED_HIGH_DAYS ? "yuksek" : "orta",
      title: `${list.length} sahibinden ilan kayıttan beri aranmadı`,
      why: "Yeni kaydedilen ilan sahibine ilk günlerde ulaşmak, rakip emlakçılardan önce yetki almayı kolaylaştırır.",
      evidence: [
        { label: "Aranmayan ilan", value: String(list.length) },
        { label: "En eski kayıt", value: gunText(oldest) },
      ],
      href: `${BASE}?durum=yeni&aranmadi=1`,
      entityType: "fsbo_advisor",
      entityId: userId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fsbo_uncalled", userId, week),
      validUntilMs: nowMs + dayMs(3),
      audience: { type: "user", userId },
      urgencyDays: null,
      impact: Math.min(10, list.length * 2),
    });
  }
  return { drafts, liveEntityIds: liveIdsOf(drafts) };
}

/** Bugün (ya da gecikmiş) tekrar arama günü olan ilanlar. */
export function evaluateFsboFollowupDue(facts: readonly FsboFact[], nowMs: number): InsightRuleRun {
  const day = dayPeriod(nowMs);
  const drafts: InsightDraft[] = [];
  for (const [userId, list] of group(facts, (f) => OPEN.has(f.status) && f.nextActionMs != null && f.nextActionMs <= nowMs && f.contactAttempts > 0)) {
    const overdue = Math.max(...list.map((f) => days(f.nextActionMs ?? nowMs, nowMs)));
    drafts.push({
      kind: "call_priority",
      ruleId: FSBO_FOLLOWUP_RULE_ID,
      severity: overdue >= 3 ? "yuksek" : "orta",
      title: `Bugün ${list.length} ilan sahibini tekrar arama günü`,
      why: "Takip ritmi (0, 3, 7, 14, 21, 30. gün) bu ilanlar için bugün temas diyor; düzenli takip ilk aramadan daha çok yetki getirir.",
      evidence: [
        { label: "Tekrar aranacak", value: String(list.length) },
        { label: "En çok gecikme", value: gunText(overdue) },
      ],
      href: `${BASE}?gorunum=bugun`,
      entityType: "fsbo_advisor",
      entityId: userId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fsbo_followup", userId, day),
      validUntilMs: nowMs + dayMs(1),
      audience: { type: "user", userId },
      urgencyDays: overdue,
      impact: Math.min(10, list.length * 2),
    });
  }
  return { drafts, liveEntityIds: liveIdsOf(drafts) };
}

/** Son 7 günde fiyatı düşen, henüz anlaşılmamış ilanlar (ilan başına kart). */
export function evaluateFsboPriceDrop(facts: readonly FsboFact[], nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.assignedTo || !(f.status === "yeni" || f.status === "arandi")) continue;
    if (f.lastPriceDropMs == null || f.lastPriceDropPct == null) continue;
    if (nowMs - f.lastPriceDropMs > PRICE_DROP_WINDOW_DAYS * DAY_MS) continue;
    // Düşüşten sonra temas kuruldu: fırsat işlendi.
    if (f.lastContactMs != null && f.lastContactMs >= f.lastPriceDropMs) continue;
    const pct = Math.round(f.lastPriceDropPct);
    drafts.push({
      kind: "call_priority",
      ruleId: FSBO_PRICE_DROP_RULE_ID,
      severity: pct >= 5 ? "yuksek" : "orta",
      title: `${place(f)} ilanında fiyat %${pct} düştü`,
      why: "Fiyatını düşüren ilan sahibi esnemeye hazır olabilir; emsal verisiyle konuşmak için iyi bir an.",
      evidence: [
        { label: "Fiyat düşüşü", value: `%${pct}` },
        { label: "Ne zaman", value: `${days(f.lastPriceDropMs, nowMs)} gün önce` },
      ],
      href: `${BASE}?fiyat_dustu=1`,
      entityType: "fsbo_lead",
      entityId: f.id,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fsbo_price_drop", f.id, String(f.lastPriceDropMs)),
      validUntilMs: f.lastPriceDropMs + dayMs(PRICE_DROP_WINDOW_DAYS),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: Math.min(10, pct),
    });
  }
  return { drafts, liveEntityIds: liveIdsOf(drafts) };
}

/** Daha önce kayıp olan ilanın yeniden yayına çıkması (son 7 gün). */
export function evaluateFsboRelisted(facts: readonly FsboFact[], nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.assignedTo || !f.relistOf || !(f.status === "yeni" || f.status === "arandi")) continue;
    if (nowMs - f.createdMs > PRICE_DROP_WINDOW_DAYS * DAY_MS) continue;
    if (f.lastContactMs != null && f.lastContactMs >= f.createdMs) continue;
    drafts.push({
      kind: "call_priority",
      ruleId: FSBO_RELISTED_RULE_ID,
      severity: "yuksek",
      title: "Önceden kaybettiğiniz ilan yeniden yayında",
      why: "İlan sahibi daha önce satamadı ya da vazgeçti ve ilanı yeniden yayına aldı; yeniden denemek için en uygun zamanlardan biri.",
      evidence: [
        { label: "İlan", value: place(f) },
        { label: "Yeniden yayın", value: `${days(f.createdMs, nowMs)} gün önce` },
      ],
      href: `${BASE}/${f.id}`,
      entityType: "fsbo_lead",
      entityId: f.id,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fsbo_relisted", f.id),
      validUntilMs: f.createdMs + dayMs(PRICE_DROP_WINDOW_DAYS),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: 8,
    });
  }
  return { drafts, liveEntityIds: liveIdsOf(drafts) };
}

/** 45+ gündür satılamayan, uzun süredir temas edilmemiş ilanlar (danışman başına tek kart). */
export function evaluateFsboAging(facts: readonly FsboFact[], nowMs: number): InsightRuleRun {
  const week = weekPeriod(nowMs);
  const age = (f: FsboFact) => days(f.listedAtMs ?? f.firstSeenMs, nowMs);
  const drafts: InsightDraft[] = [];
  for (const [userId, list] of group(
    facts,
    (f) => f.status === "arandi" && age(f) >= AGING_DAYS && (f.lastContactMs == null || nowMs - f.lastContactMs >= AGING_NO_CONTACT_DAYS * DAY_MS),
  )) {
    drafts.push({
      kind: "call_priority",
      ruleId: FSBO_AGING_RULE_ID,
      severity: "orta",
      title: `${AGING_DAYS} gündür satılamayan ${list.length} sahibinden ilan: değer odaklı yeniden temas`,
      why: "Uzun süredir satılamayan ilanların sahipleri çoğu zaman yeni bir bakış açısına açıktır; yeni emsal ya da piyasa notuyla dönün.",
      evidence: [
        { label: "İlan sayısı", value: String(list.length) },
        { label: "En eski ilan", value: gunText(Math.max(...list.map(age))) },
      ],
      href: `${BASE}?yas=45&durum=arandi`,
      entityType: "fsbo_advisor",
      entityId: userId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fsbo_aging", userId, week),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "user", userId },
      urgencyDays: null,
      impact: Math.min(10, list.length),
    });
  }
  return { drafts, liveEntityIds: liveIdsOf(drafts) };
}

/** Yönetici: hareketsiz kayıtların sahipliği 2 gün içinde düşecek (danışman başına tek kart). */
export function evaluateFsboClaimExpiring(facts: readonly FsboFact[], nowMs: number): InsightRuleRun {
  const week = weekPeriod(nowMs);
  const drafts: InsightDraft[] = [];
  for (const [userId, list] of group(
    facts,
    (f) => (f.status === "yeni" || f.status === "arandi") && f.claimExpiresMs != null && f.claimExpiresMs > nowMs && f.claimExpiresMs - nowMs <= CLAIM_WARN_DAYS * DAY_MS,
  )) {
    const who = nameOr(list[0]?.assigneeName, "Bir danışmanın");
    drafts.push({
      kind: "call_priority",
      ruleId: FSBO_CLAIM_RULE_ID,
      severity: "orta",
      title: `${who} ${list.length} sahibinden ilanı hareketsiz: sahiplik ${CLAIM_WARN_DAYS} gün içinde düşecek`,
      why: "Hareketsiz kayıtların sahipliği süre dolunca serbest kalır ve başka danışman alabilir; ilgilenilmiyorsa yeniden atayın.",
      evidence: [
        { label: "Danışman", value: who },
        { label: "Hareketsiz ilan", value: String(list.length) },
      ],
      href: `${BASE}?danisman=${userId}&hareketsiz=1`,
      entityType: "fsbo_advisor",
      entityId: userId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fsbo_claim", userId, week),
      validUntilMs: nowMs + dayMs(CLAIM_WARN_DAYS),
      audience: { type: "management" },
      urgencyDays: null,
      impact: Math.min(10, list.length),
    });
  }
  return { drafts, liveEntityIds: liveIdsOf(drafts) };
}
