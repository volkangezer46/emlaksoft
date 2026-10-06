import {
  INSIGHT_CONFIDENCES,
  INSIGHT_KINDS,
  INSIGHT_SEVERITIES,
  INSIGHT_STATES,
  type Insight,
  type InsightEvidence,
  type InsightKind,
  type InsightSeverity,
  type InsightState,
} from "@/lib/insights/types";

/**
 * DB satırı → tipli `Insight` ve "okunabilir mi" kararı (SAF; sunucu modülü yok, test edilir).
 * Okunabilir: kapanmamış (yoksayılmamış/uygulanmamış), süresi geçmemiş, ertelenmişse erteleme süresi dolmuş.
 */

export type InsightDbRow = {
  id: string;
  kind: string;
  rule_id: string;
  severity: string;
  priority: number | null;
  title: string;
  why: string;
  evidence: unknown;
  href: string;
  entity_type: string | null;
  entity_id: string | null;
  is_forecast: boolean | null;
  confidence: string | null;
  state: string;
  snoozed_until: string | null;
  valid_until: string;
  created_at: string;
  narrative: string | null;
  narrative_source: string | null;
};

export const INSIGHT_SELECT =
  "id, kind, rule_id, severity, priority, title, why, evidence, href, entity_type, entity_id, is_forecast, confidence, state, snoozed_until, valid_until, created_at, narrative, narrative_source";

const oneOf = <T extends string>(list: readonly T[], v: string, fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);

export function toEvidence(raw: unknown): InsightEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: InsightEvidence[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.label !== "string" || typeof o.value !== "string") continue;
    out.push({ label: o.label, value: o.value, ...(typeof o.href === "string" && o.href.startsWith("/") ? { href: o.href } : {}) });
  }
  return out;
}

export function mapInsightRow(r: InsightDbRow): Insight {
  return {
    id: r.id,
    kind: oneOf<InsightKind>(INSIGHT_KINDS, r.kind, "digest"),
    ruleId: r.rule_id,
    severity: oneOf<InsightSeverity>(INSIGHT_SEVERITIES, r.severity, "bilgi"),
    priority: Math.max(0, Math.min(100, Number(r.priority) || 0)),
    title: r.title,
    why: r.why,
    evidence: toEvidence(r.evidence),
    href: r.href.startsWith("/") ? r.href : "/app",
    entityType: r.entity_type,
    entityId: r.entity_id,
    isForecast: Boolean(r.is_forecast),
    confidence: r.confidence && (INSIGHT_CONFIDENCES as readonly string[]).includes(r.confidence) ? (r.confidence as Insight["confidence"]) : null,
    state: oneOf<InsightState>(INSIGHT_STATES, r.state, "new"),
    snoozedUntil: r.snoozed_until,
    validUntil: r.valid_until,
    createdAt: r.created_at,
    narrative: r.narrative && r.narrative.trim() ? r.narrative : null,
    narrativeSource: r.narrative_source === "ai" ? "ai" : "rule",
  };
}

/** Okunabilir mi: süresi geçmemiş, kapanmamış, ertelenmişse süresi dolmuş. */
export function isReadable(r: Pick<InsightDbRow, "state" | "snoozed_until" | "valid_until">, nowMs: number): boolean {
  if (r.state === "dismissed" || r.state === "accepted") return false;
  const valid = new Date(r.valid_until).getTime();
  if (!Number.isFinite(valid) || valid <= nowMs) return false;
  if (r.state === "snoozed") {
    const until = r.snoozed_until ? new Date(r.snoozed_until).getTime() : Number.NaN;
    // Erteleme süresi bilinmiyorsa/bitmediyse gösterme; bitince tekrar görünür.
    if (!Number.isFinite(until) || until > nowMs) return false;
  }
  return true;
}

/** Okunabilir satırları öncelik azalan, sonra yeni önce sıralar ve `limit` ile keser. */
export function selectReadable(rows: readonly InsightDbRow[], nowMs: number, limit: number): Insight[] {
  return rows
    .filter((r) => isReadable(r, nowMs))
    .map(mapInsightRow)
    .sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, limit));
}
