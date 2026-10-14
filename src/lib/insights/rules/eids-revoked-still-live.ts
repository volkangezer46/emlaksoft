import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { capPerUser, dayMs, liveIdsOf, nameOr } from "@/lib/insights/rules/common";
import type { EidsPropertyFact } from "@/lib/insights/eids-facts";

/**
 * Kural: eids_revoked_still_live@1 — EİDS yetkisi İPTAL edilmiş ya da SÜRESİ DOLMUŞ, ama portalda hâlâ canlı ilan kaydı
 * (portal_listings.status='live') var. Yönetmelik md. 14/2-h, 14/2-j: ilan kaldırılmalı.
 *
 * `authority_expired@1` portföyün kendi `live` durumuna bakar ve 60 günle sınırlıdır; bu kural PORTAL kaydına bakar ve süre
 * sınırı yoktur (portalda unutulan ilan en riskli olandır). Dedupe öneki farklıdır.
 * Veri yoksa kart yok: yalnız kayıtlı durum/tarih ve gerçek canlı portal kaydı (tahmin değil).
 */
export const EIDS_REVOKED_LIVE_RULE_ID = "eids_revoked_still_live@1";
export const EIDS_REVOKED_LIVE_MAX_PER_USER = 5;

export function evaluateEidsRevokedStillLive(facts: readonly EidsPropertyFact[], todayKey: string, nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.assignedTo || f.liveListings < 1) continue;
    const revoked = f.eidsStatus === "revoked";
    const expired = f.eidsStatus === "expired" || Boolean(f.authorizationEnd && f.authorizationEnd < todayKey);
    if (!revoked && !expired) continue;
    const name = nameOr(f.label, "İlan");
    drafts.push({
      kind: "compliance",
      ruleId: EIDS_REVOKED_LIVE_RULE_ID,
      severity: "yuksek",
      title: `Yetki ${revoked ? "iptal edildi" : "süresi doldu"} ama ilan portalda yayında: ${name}`,
      why: "EİDS yetkisi sona eren taşınmazın ilanı yayında kalamaz (Yönetmelik md. 14/2-h, 14/2-j; idari para cezası 28.620 – 858.620 TL). Kaldırma görevindeki kontrol listesiyle her portaldan kaldırın.",
      evidence: [
        { label: "Yetki", value: revoked ? "İptal edildi" : f.authorizationEnd ? `Bitti (${f.authorizationEnd})` : "Süresi doldu" },
        { label: "Canlı portal kaydı", value: String(f.liveListings) },
      ],
      href: "/app/gorevler?tur=eids_takedown",
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("eids-revoked-live", f.propertyId, revoked ? "revoked" : (f.authorizationEnd ?? "expired")),
      validUntilMs: nowMs + dayMs(2),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: 0,
      impact: 5,
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  return { drafts: capPerUser(drafts, EIDS_REVOKED_LIVE_MAX_PER_USER, (a, b) => (b.impact ?? 0) - (a.impact ?? 0)), liveEntityIds };
}
