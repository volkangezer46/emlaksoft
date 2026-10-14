import { buildDedupeKey, monthPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { capPerUser, dayMs, liveIdsOf, nameOr } from "@/lib/insights/rules/common";
import type { EidsPropertyFact } from "@/lib/insights/eids-facts";

/**
 * Kural: eids_no_email_seen@1 — yetki 'approved' görünüyor ama 120 gündür hiçbir teyit (Bakanlık e-postası, e-Devlet
 * belgesi, portal doğrulaması) yok. Malik yetkiyi sessizce iptal etmiş olabilir; e-posta her işlemde gelmeyebilir.
 * Onay 120 günden yeni ise kart yok. Yalnız yayındaki (vitrin ya da portal) portföy. Teyit sütunları (EP2) yoksa
 * kural "etkin değil" sayılır (çağıran tarafından; burada saf değerlendirme).
 */
export const EIDS_NO_EMAIL_RULE_ID = "eids_no_email_seen@1";
export const EIDS_NO_EMAIL_DAYS = 120;
export const EIDS_NO_EMAIL_MAX_PER_USER = 5;

export function evaluateEidsNoEmailSeen(facts: readonly EidsPropertyFact[], nowMs: number): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  const limit = nowMs - dayMs(EIDS_NO_EMAIL_DAYS);
  for (const f of facts) {
    if (!f.assignedTo || f.eidsStatus !== "approved") continue;
    if (f.liveListings < 1 && f.status !== "live") continue;
    const last = Date.parse(f.lastConfirmationAt ?? f.approvedAt ?? "");
    if (!Number.isFinite(last) || last > limit) continue;
    const days = Math.floor((nowMs - last) / dayMs(1));
    const name = nameOr(f.label, "İlan");
    drafts.push({
      kind: "compliance",
      ruleId: EIDS_NO_EMAIL_RULE_ID,
      severity: "orta",
      title: `${days} gündür yetki teyidi yok: ${name}`,
      why: `Yetki onaylı görünüyor ama ${EIDS_NO_EMAIL_DAYS} günü aşkın süredir Bakanlık e-postası, e-Devlet belgesi ya da portal doğrulaması gelmedi. Malikten güncel e-Devlet ekran görüntüsünü isteyin ya da portalda doğrulayıp işaretleyin.`,
      evidence: [
        { label: "Son teyit", value: f.lastConfirmationAt ? String(f.lastConfirmationAt).slice(0, 10) : "Kayıt yok" },
        { label: "Geçen süre", value: `${days} gün` },
      ],
      href: `/app/portfoyler/${f.propertyId}`,
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("eids-no-email", f.propertyId, monthPeriod(nowMs)),
      validUntilMs: nowMs + dayMs(14),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: 2,
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  return { drafts: capPerUser(drafts, EIDS_NO_EMAIL_MAX_PER_USER, (a, b) => (b.impact ?? 0) - (a.impact ?? 0)), liveEntityIds };
}
