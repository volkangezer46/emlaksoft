import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { MAX_PER_RECIPIENT_PER_RULE, capPerUser, dayMs, liveIdsOf, nameOr } from "@/lib/insights/rules/common";
import { kindMeta } from "@/lib/approvals";

/**
 * Kural: approval_stale@1 — onay talebi (approval_requests, durum "bekliyor") uzun süredir karar bekliyor.
 *
 * - {@link APPROVAL_REMIND_HOURS} saat geçti → karar verebilen yöneticilere (canDecideApproval: yönetim kademesi + etkin
 *   commissions:edit; olgu yükleyicisi çözer) HATIRLATMA kartı.
 * - {@link APPROVAL_ESCALATE_HOURS} saat geçti → ofis SAHİBİNE (owner) ayrı anahtarlı YÜKSELTME kartı.
 * Talep sahibi hiçbir zaman alıcı değildir (kendi talebine karar veremez). Onay akışı ofis geneli: şube kapsamlı karar
 * verici yok (bkz. actions/approvals.ts → approvalDeciderIds), bu yüzden alıcılar ofis genelinden çözülür.
 */

export const APPROVAL_STALE_RULE_ID = "approval_stale@1";
export const APPROVAL_REMIND_HOURS = 24;
export const APPROVAL_ESCALATE_HOURS = 72;
export const APPROVAL_STALE_MAX_PER_USER = MAX_PER_RECIPIENT_PER_RULE;

const HOUR_MS = 3_600_000;

export type ApprovalStaleFact = {
  requestId: string;
  kind: string;
  title: string | null;
  requestedBy: string | null;
  requesterName: string | null;
  /** created_at (epoch ms). */
  createdAtMs: number;
};

/** Karar verebilen yönetici (canDecideApproval süzgecinden geçmiş). */
export type ApprovalDecider = { id: string; role: string };

const ageText = (hours: number): string => (hours >= 48 ? `${Math.floor(hours / 24)} gün` : `${Math.floor(hours)} saat`);

export function evaluateApprovalStaleRun(
  facts: readonly ApprovalStaleFact[],
  deciders: readonly ApprovalDecider[],
  nowMs: number,
): InsightRuleRun {
  const drafts: InsightDraft[] = [];
  for (const f of facts) {
    if (!f.requestId || !Number.isFinite(f.createdAtMs)) continue;
    const hours = (nowMs - f.createdAtMs) / HOUR_MS;
    if (hours < APPROVAL_REMIND_HOURS) continue;
    const escalate = hours >= APPROVAL_ESCALATE_HOURS;
    const subject = nameOr(f.title, "Onay talebi");
    const evidence = [
      { label: "Tür", value: kindMeta(f.kind).label },
      { label: "Bekleme", value: ageText(hours) },
      ...(f.requesterName ? [{ label: "Talep eden", value: nameOr(f.requesterName, "") }] : []),
    ];
    const base = {
      kind: "deadline" as const,
      ruleId: APPROVAL_STALE_RULE_ID,
      href: "/app/onaylar?durum=bekliyor",
      entityType: "approval_request",
      entityId: f.requestId,
      isForecast: false,
      confidence: null,
      validUntilMs: nowMs + dayMs(3),
      urgencyDays: -Math.floor(hours / 24),
      evidence,
    };
    const eligible = deciders.filter((d) => d.id && d.id !== f.requestedBy);
    const owners = escalate ? eligible.filter((d) => d.role === "owner") : [];
    const ownerIds = new Set(owners.map((o) => o.id));
    for (const d of eligible) {
      if (ownerIds.has(d.id)) continue; // sahip yükseltme kartını alır; aynı talep için ikinci kart yok.
      drafts.push({
        ...base,
        severity: escalate ? "yuksek" : "orta",
        title: `Onay bekliyor (${ageText(hours)}): ${subject}`,
        why: "Bu talep bir günden uzun süredir karar bekliyor. Danışman müşteriye yanıt veremiyor; gerekçeli onay ya da ret kararı verin.",
        dedupeKey: buildDedupeKey("approval-stale", f.requestId, "hatirlat"),
        audience: { type: "user", userId: d.id },
        impact: 2,
      });
    }
    for (const o of owners) {
      drafts.push({
        ...base,
        severity: "yuksek",
        title: `Onay ${ageText(hours)} sonuçlanmadı: ${subject}`,
        why: "Bu talep üç günden uzun süredir karar bekliyor ve yöneticiler tarafından sonuçlandırılmadı. Kararı siz verin ya da ilgili yöneticiyle görüşün.",
        dedupeKey: buildDedupeKey("approval-stale", f.requestId, "yukselt"),
        audience: { type: "user", userId: o.id },
        impact: 3,
      });
    }
  }
  const liveEntityIds = liveIdsOf(drafts);
  const byUrgency = (a: InsightDraft, b: InsightDraft) => (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0);
  return { drafts: capPerUser(drafts, APPROVAL_STALE_MAX_PER_USER, byUrgency), liveEntityIds };
}

export function evaluateApprovalStale(facts: readonly ApprovalStaleFact[], deciders: readonly ApprovalDecider[], nowMs: number): InsightDraft[] {
  return evaluateApprovalStaleRun(facts, deciders, nowMs).drafts;
}
