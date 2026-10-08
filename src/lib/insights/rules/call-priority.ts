import { callPriorityLevel } from "@/lib/customer-state/core";
import { CALL_MIN_QUIET_DAYS } from "@/lib/customer-state/thresholds";
import { buildDedupeKey, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { capPerUser, dayMs, gunText, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: call_priority — "Bugün ara" (neden etiketli aranacak liste).
 *
 * Olgu: `insight_quiet_valuable_customers` RPC'si (açık talebi olan, atanmış, son teması N günden eski müşteri).
 * "Bugün aradım / not düştüm" → son temas tazelenir, müşteri RPC'den düşer (yanlış alarm kendiliğinden kapanır).
 * "İlgilenmiyor" yoksayma → 30 gün bastırma (engine, dedupe.suppressionKey).
 */

export const CALL_PRIORITY_RULE_ID = "call_priority@1";
/** Bundan az sessizlikte aranmaya değer sayılmaz. */
export { CALL_MIN_QUIET_DAYS };
/** Alıcı başına en çok 3 müşteri (odaklı liste). */
export const CALL_MAX_PER_USER = 3;

export type QuietCustomerFact = {
  customerId: string;
  assignedTo: string;
  fullName: string | null;
  activeDemands: number;
  quietDays: number;
};

/** `minQuietDays`: ofis tanımı (office.insight.customer_quiet_days); verilmezse CALL_MIN_QUIET_DAYS. */
export function evaluateCallPriority(facts: readonly QuietCustomerFact[], nowMs: number, minQuietDays: number = CALL_MIN_QUIET_DAYS): InsightDraft[] {
  const week = weekPeriod(nowMs);
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    // Uygunluk + öncelik eşikleri tek yerde (customer-state/core `callPriorityLevel`).
    const severity = f.assignedTo ? callPriorityLevel(f, minQuietDays) : null;
    if (!severity) continue;
    const who = nameOr(f.fullName, "Müşteri");
    drafts.push({
      kind: "call_priority",
      ruleId: CALL_PRIORITY_RULE_ID,
      severity,
      title: `${who} ile görüş`,
      why: `${f.quietDays} gündür temas yok ve ${f.activeDemands} açık talebi var; sessiz kalan müşteri soğumadan aramak dönüşümü artırır.`,
      evidence: [
        { label: "Sessizlik", value: gunText(f.quietDays) },
        { label: "Açık talep", value: String(f.activeDemands) },
      ],
      href: `/app/musteriler/${f.customerId}`,
      entityType: "customer",
      entityId: f.customerId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("call", f.customerId, week),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: Math.min(10, f.activeDemands * 2),
    });
  }
  return capPerUser(drafts, CALL_MAX_PER_USER, (a, b) => {
    const ai = a.impact ?? 0;
    const bi = b.impact ?? 0;
    return bi - ai || (a.entityId ?? "").localeCompare(b.entityId ?? "");
  });
}
