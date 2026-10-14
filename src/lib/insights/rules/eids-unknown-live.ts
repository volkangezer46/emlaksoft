import { buildDedupeKey, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { capPerUser, dayMs, liveIdsOf, nameOr } from "@/lib/insights/rules/common";
import { hasValidEidsNo } from "@/lib/eids/property-no";
import type { EidsPropertyFact } from "@/lib/insights/eids-facts";

/**
 * Kural: eids_unknown_live@1 — portalda canlı ilan var ama EİDS yetki durumu BİLİNMİYOR (kayıt yok / 'unknown') ya da
 * taşınmaz numarası girilmemiş. Bakanlık e-postası gelmeyen durumda yetkiyi teyit etmenin yolu danışmandır.
 * Haftalık dönem anahtarı: aynı portföy için haftada en çok bir kart. İptal/dolmuş yetki `eids_revoked_still_live@1`'dedir.
 */
export const EIDS_UNKNOWN_LIVE_RULE_ID = "eids_unknown_live@1";
export const EIDS_UNKNOWN_LIVE_MAX_PER_USER = 5;

export function evaluateEidsUnknownLive(facts: readonly EidsPropertyFact[], nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.assignedTo || f.liveListings < 1) continue;
    if (f.eidsStatus === "revoked" || f.eidsStatus === "expired") continue;
    const unknown = !f.eidsStatus || f.eidsStatus === "unknown";
    const noNumber = !hasValidEidsNo(f.eidsNo);
    if (!unknown && !noNumber) continue;
    const name = nameOr(f.label, "İlan");
    drafts.push({
      kind: "compliance",
      ruleId: EIDS_UNKNOWN_LIVE_RULE_ID,
      severity: "orta",
      title: unknown ? `Yayında ama EİDS yetkisi bilinmiyor: ${name}` : `Yayında ama taşınmaz no girilmemiş: ${name}`,
      why: "Portalda yayında olan ilanın EİDS yetkisi kayıtlı değil. Malikten e-Devlet \"EİDS Yetki İşlemleri\" ekran görüntüsünü isteyin ya da portalda doğrulayıp portföyün yetki kartına işleyin.",
      evidence: [
        { label: "Yetki durumu", value: unknown ? "Bilinmiyor" : "Kayıtlı" },
        { label: "Taşınmaz no", value: noNumber ? "Yok" : "Var" },
        { label: "Canlı portal kaydı", value: String(f.liveListings) },
      ],
      href: `/app/portfoyler/${f.propertyId}`,
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("eids-unknown-live", f.propertyId, weekPeriod(nowMs)),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: 3,
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  return { drafts: capPerUser(drafts, EIDS_UNKNOWN_LIVE_MAX_PER_USER, (a, b) => (b.impact ?? 0) - (a.impact ?? 0)), liveEntityIds };
}
