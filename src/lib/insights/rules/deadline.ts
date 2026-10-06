import { buildDedupeKey, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { capPerUser, dayMs, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: deadline — yetki belgesi bitişi (geriye sayım) ve gecikmiş portal teyidi (satır bazlı, kayıt adlı).
 *
 * Olgu: `insight_deadlines` RPC'si. `daysLeft`: kalan gün (negatif = gecikme). Teyit için `daysLeft = 7 - sessizGün`,
 * yani teyit son tarihi 7 gündür; <=0 gecikmiş demektir.
 */

export const DEADLINE_RULE_ID = "deadline@1";
export const AUTHORITY_WINDOW_DAYS = 15;
export const AUTHORITY_MAX_PER_USER = 5;
export const CONFIRM_MAX_PER_USER = 3;

export type DeadlineFact = {
  kind: "authority" | "confirm";
  entityId: string;
  assignedTo: string;
  label: string | null;
  /** "YYYY-AA-GG" (yetki bitişi); teyitte null. */
  dueDate: string | null;
  daysLeft: number;
};

export function evaluateDeadlines(facts: readonly DeadlineFact[], nowMs: number): InsightDraft[] {
  const week = weekPeriod(nowMs);
  const authority: InsightDraft[] = [];
  const confirm: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.assignedTo) continue;
    const name = nameOr(f.label, "İlan");
    if (f.kind === "authority") {
      if (f.daysLeft < 0 || f.daysLeft > AUTHORITY_WINDOW_DAYS) continue;
      const severity = f.daysLeft <= 3 ? "yuksek" : f.daysLeft <= 7 ? "orta" : "bilgi";
      authority.push({
        kind: "deadline",
        ruleId: DEADLINE_RULE_ID,
        severity,
        title: f.daysLeft === 0 ? `Yetki belgesi bugün bitiyor: ${name}` : `Yetki belgesi ${f.daysLeft} gün sonra bitiyor: ${name}`,
        why: "Yetki süresi dolan portföy sahibiyle yenileme konuşulmazsa ilan yetkisiz kalır; süre dolmadan yenileme belgesini alın.",
        evidence: [
          { label: "Kalan", value: `${f.daysLeft} gün` },
          ...(f.dueDate ? [{ label: "Bitiş", value: f.dueDate }] : []),
        ],
        href: `/app/portfoyler/${f.entityId}`,
        entityType: "property",
        entityId: f.entityId,
        isForecast: false,
        confidence: null,
        // Dönem = bitiş tarihinin kendisi: yenilenince (yeni tarih) yeni anahtar, aynı tarih için tekrar yok.
        dedupeKey: buildDedupeKey("deadline-authority", f.entityId, f.dueDate ?? week),
        validUntilMs: nowMs + dayMs(Math.max(1, f.daysLeft + 1)),
        audience: { type: "user", userId: f.assignedTo },
        urgencyDays: f.daysLeft,
        impact: 3,
      });
    } else {
      if (f.daysLeft > 0) continue;
      const silentDays = 7 - f.daysLeft;
      confirm.push({
        kind: "deadline",
        ruleId: DEADLINE_RULE_ID,
        severity: silentDays >= 14 ? "orta" : "bilgi",
        title: `İlan teyidi ${silentDays} gündür yapılmadı: ${name}`,
        why: "Teyitsiz kalan portal ilanı eski bilgiyle yayında kalabilir; ilanı kontrol edip teyit edin.",
        evidence: [{ label: "Son teyitten beri", value: `${silentDays} gün` }],
        href: "/app/portallar?durum=teyit",
        entityType: "property",
        entityId: f.entityId,
        isForecast: false,
        confidence: null,
        dedupeKey: buildDedupeKey("deadline-confirm", f.entityId, week),
        validUntilMs: nowMs + dayMs(7),
        audience: { type: "user", userId: f.assignedTo },
        urgencyDays: f.daysLeft,
        impact: 2,
      });
    }
  }
  const rank = (a: InsightDraft, b: InsightDraft) => (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0);
  return [...capPerUser(authority, AUTHORITY_MAX_PER_USER, rank), ...capPerUser(confirm, CONFIRM_MAX_PER_USER, rank)];
}
