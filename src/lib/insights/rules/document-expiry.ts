import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { MAX_PER_RECIPIENT_PER_RULE, capPerUser, dayMs, liveIdsOf, nameOr } from "@/lib/insights/rules/common";
import { VALIDITY_SOON_DAYS } from "@/lib/documents";

/**
 * Kural: document_expiry@1 — müşteri belgesinin geçerlilik tarihi (customer_files.valid_until) YAKLAŞIYOR ya da GEÇTİ.
 *
 * Pencere: bitişe {@link VALIDITY_SOON_DAYS} gün kalandan, bitişten {@link DOCUMENT_EXPIRED_MAX_DAYS} gün sonrasına kadar.
 * Daha eski gecikme "taze sorun" sayılmaz (Belge merkezinde ?gecerlilik=gecmis listesinde görünmeye devam eder).
 * Alıcı: müşterinin danışmanı; danışmanı yoksa yönetim. Olgu yalnız kullanıcının girdiği tarihtir (isForecast=false).
 */

export const DOCUMENT_EXPIRY_RULE_ID = "document_expiry@1";
export const DOCUMENT_EXPIRED_MAX_DAYS = 30;
export const DOCUMENT_EXPIRY_MAX_PER_USER = MAX_PER_RECIPIENT_PER_RULE;

export type DocumentExpiryFact = {
  fileId: string;
  customerId: string;
  customerName: string | null;
  fileName: string;
  label: string | null;
  /** "YYYY-AA-GG". */
  validUntil: string;
  /** Bitişe kalan gün (bugün = 0, geçmişse negatif). */
  daysLeft: number;
  /** Müşterinin danışmanı; yoksa null (yönetime gider). */
  assignedTo: string | null;
};

export function evaluateDocumentExpiryRun(facts: readonly DocumentExpiryFact[], nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.fileId || !f.validUntil) continue;
    if (f.daysLeft > VALIDITY_SOON_DAYS || f.daysLeft < -DOCUMENT_EXPIRED_MAX_DAYS) continue;
    const expired = f.daysLeft < 0;
    const doc = nameOr(f.label, nameOr(f.fileName, "Belge"));
    const who = nameOr(f.customerName, "müşteri");
    const title = expired
      ? `Belgenin süresi geçti (${-f.daysLeft} gün önce): ${doc} · ${who}`
      : f.daysLeft === 0
        ? `Belgenin süresi bugün doluyor: ${doc} · ${who}`
        : `Belgenin süresi ${f.daysLeft} gün içinde doluyor: ${doc} · ${who}`;
    drafts.push({
      kind: "deadline",
      ruleId: DOCUMENT_EXPIRY_RULE_ID,
      severity: expired ? "yuksek" : f.daysLeft <= 7 ? "orta" : "bilgi",
      title,
      why: expired
        ? "Süresi geçmiş belge (kimlik, DASK, ekspertiz vb.) işlemde geçersiz sayılabilir. Müşteriden güncel belgeyi isteyin ve yeni geçerlilik tarihini girin."
        : "Süresi dolmadan güncel belgeyi isterseniz işlem gününde eksik evrak çıkmaz. Yenilenen belgeyi yükleyip geçerlilik tarihini güncelleyin.",
      evidence: [
        { label: "Geçerlilik", value: f.validUntil },
        { label: expired ? "Geçen süre" : "Kalan süre", value: `${Math.abs(f.daysLeft)} gün` },
      ],
      href: `/app/belgeler?gecerlilik=${expired ? "gecmis" : "yaklasan"}`,
      entityType: "customer_file",
      entityId: f.fileId,
      isForecast: false,
      confidence: null,
      // Dönem = geçerlilik tarihi: tarih güncellenince yeni anahtar; aynı tarih için tekrar kart yok.
      dedupeKey: buildDedupeKey("doc-expiry", f.fileId, f.validUntil),
      validUntilMs: nowMs + dayMs(3),
      audience: f.assignedTo ? { type: "user", userId: f.assignedTo } : { type: "management" },
      urgencyDays: f.daysLeft,
      impact: expired ? 3 : 2,
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  const byUrgency = (a: InsightDraft, b: InsightDraft) => (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0);
  // capPerUser yönetim taslaklarını sınırlamaz; aynı tavanı yönetime de uygula.
  const capped = capPerUser(drafts, DOCUMENT_EXPIRY_MAX_PER_USER, byUrgency);
  const management = capped.filter((d) => d.audience.type === "management").sort(byUrgency).slice(0, DOCUMENT_EXPIRY_MAX_PER_USER);
  return { drafts: [...management, ...capped.filter((d) => d.audience.type !== "management")], liveEntityIds };
}

export function evaluateDocumentExpiry(facts: readonly DocumentExpiryFact[], nowMs: number): InsightDraft[] {
  return evaluateDocumentExpiryRun(facts, nowMs).drafts;
}
