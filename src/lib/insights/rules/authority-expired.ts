import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { capPerUser, dayMs, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: authority_expired@1 — yetki SÜRESİ DOLMUŞ ama hâlâ yayında olan portföy (EİDS yetki kuyruğu).
 *
 * ÇAKIŞMA YOK: `deadline@1` yetkiyi bitişe 0-15 gün kala, `authority_renewal@1` 16-30 gün kala yakalar; bu kural YALNIZ
 * bitişi GEÇMİŞ (daysLeft < 0) yetkiyi yakalar. Üç kural birlikte yetkinin tüm yaşam çizgisini kapsar, hiçbiri diğerini
 * tekrarlamaz (dedupe anahtarları da farklı önek taşır).
 * Veri yoksa kart yok: olgu yalnız gerçek `authorization_end` tarihidir; tahmin değil (isForecast=false).
 */

export const AUTHORITY_EXPIRED_RULE_ID = "authority_expired@1";
/** Bitişi bu kadar günden eskiyse artık "taze sorun" sayılmaz (kart üretilmez; kuyrukta görünmeye devam eder). */
export const AUTHORITY_EXPIRED_MAX_DAYS = 60;
export const AUTHORITY_EXPIRED_MAX_PER_USER = 5;

export type AuthorityExpiredFact = {
  propertyId: string;
  assignedTo: string;
  label: string | null;
  /** "YYYY-AA-GG". */
  endDate: string;
  /** Bitişten bu yana geçen gün (pozitif). */
  daysOverdue: number;
};

export function evaluateAuthorityExpired(facts: readonly AuthorityExpiredFact[], nowMs: number): InsightDraft[] {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.assignedTo) continue;
    if (f.daysOverdue < 1 || f.daysOverdue > AUTHORITY_EXPIRED_MAX_DAYS) continue;
    const name = nameOr(f.label, "İlan");
    drafts.push({
      kind: "deadline",
      ruleId: AUTHORITY_EXPIRED_RULE_ID,
      severity: f.daysOverdue >= 15 ? "yuksek" : "orta",
      title: `Yetki süresi doldu (${f.daysOverdue} gündür): ${name}`,
      why: "Yetki süresi dolan portföy yayında kalırsa ilan yetkisiz sayılabilir. Mal sahibinden e-Devlet EİDS yenilemesini alın ya da ilanı yayından kaldırın.",
      evidence: [
        { label: "Bitiş", value: f.endDate },
        { label: "Geçen süre", value: `${f.daysOverdue} gün` },
      ],
      href: "/app/ilan-kontrol/yetki?kova=dolmus",
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: null,
      // Dönem = bitiş tarihi: yenilenince (yeni tarih) yeni anahtar; aynı tarih için tekrar kart yok.
      dedupeKey: buildDedupeKey("auth-expired", f.propertyId, f.endDate),
      validUntilMs: nowMs + dayMs(3),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: -f.daysOverdue,
      impact: 4,
    });
  }
  return capPerUser(drafts, AUTHORITY_EXPIRED_MAX_PER_USER, (a, b) => (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0));
}
