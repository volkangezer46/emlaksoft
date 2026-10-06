import { INSIGHT_CONFIDENCES, INSIGHT_SEVERITIES, type InsightConfidence, type InsightEvidence, type InsightSeverity } from "@/lib/insights/types";
import { isReadable, toEvidence } from "@/lib/insights/readable";
import { platformCanAccess, type PlatformModule, type PlatformRole } from "@/lib/platform-access";

/**
 * Platform içgörüsü: DB satırı -> tipli kayıt ve rol süzgeci (SAF; sunucu modülü yok, test edilir).
 * Tenant kimliği (tenant_id/entity_id) SEÇİLMEZ ve döndürülmez; hedef yalnız /admin altı bir yola iner.
 */

export const PLATFORM_INSIGHT_KINDS = [
  "tenant_churn",
  "revenue_anomaly",
  "payment_risk",
  "system_health",
  "partner_signal",
  "anomaly",
  "forecast",
  "digest",
] as const;
export type PlatformInsightKind = (typeof PLATFORM_INSIGHT_KINDS)[number];

export type PlatformInsightDbRow = {
  id: string;
  kind: string;
  rule_id: string;
  severity: string;
  priority: number | null;
  title: string;
  why: string;
  evidence: unknown;
  href: string;
  is_forecast: boolean | null;
  confidence: string | null;
  state: string;
  snoozed_until: string | null;
  valid_until: string;
  created_at: string;
};

/** Bilerek tenant_id / entity_id / entity_type içermez. */
export const PLATFORM_INSIGHT_SELECT =
  "id, kind, rule_id, severity, priority, title, why, evidence, href, is_forecast, confidence, state, snoozed_until, valid_until, created_at";

export type PlatformInsight = {
  id: string;
  kind: PlatformInsightKind;
  ruleId: string;
  severity: InsightSeverity;
  priority: number;
  title: string;
  why: string;
  evidence: InsightEvidence[];
  href: string;
  isForecast: boolean;
  confidence: InsightConfidence | null;
  createdAt: string;
};

/** Hangi içgörü türünü hangi departman görür (href'in gittiği ekranın modülüyle uyumlu). */
const KIND_MODULE: Record<PlatformInsightKind, PlatformModule> = {
  tenant_churn: "tenants",
  revenue_anomaly: "billing",
  payment_risk: "billing",
  system_health: "sistem",
  partner_signal: "dashboard",
  anomaly: "dashboard",
  forecast: "dashboard",
  digest: "dashboard",
};

export function platformInsightModule(kind: PlatformInsightKind): PlatformModule {
  return KIND_MODULE[kind];
}

/** Yalnız /admin altı iç yol; aksi (dış, tenant /app, protokol-göreli, /administrator) /admin'e düşer. */
export function safeAdminHref(href: string): string {
  if (typeof href !== "string" || !href.startsWith("/admin")) return "/admin";
  const next = href.charAt(6);
  return next === "" || next === "/" || next === "?" || next === "#" ? href : "/admin";
}

function mapRow(r: PlatformInsightDbRow): PlatformInsight | null {
  if (!(PLATFORM_INSIGHT_KINDS as readonly string[]).includes(r.kind)) return null;
  const evidence = toEvidence(r.evidence).map((e) => (e.href ? { ...e, href: safeAdminHref(e.href) } : e));
  return {
    id: r.id,
    kind: r.kind as PlatformInsightKind,
    ruleId: r.rule_id,
    severity: (INSIGHT_SEVERITIES as readonly string[]).includes(r.severity) ? (r.severity as InsightSeverity) : "bilgi",
    priority: Math.max(0, Math.min(100, Number(r.priority) || 0)),
    title: r.title,
    why: r.why,
    evidence,
    href: safeAdminHref(r.href),
    isForecast: Boolean(r.is_forecast),
    confidence: r.confidence && (INSIGHT_CONFIDENCES as readonly string[]).includes(r.confidence) ? (r.confidence as InsightConfidence) : null,
    createdAt: r.created_at,
  };
}

/** Okunabilir (kapanmamış, süresi geçmemiş, uyanmış) + rolün görebildiği satırlar; öncelik azalan, sonra yeni önce. */
export function selectPlatformReadable(rows: readonly PlatformInsightDbRow[], nowMs: number, role: PlatformRole, limit: number): PlatformInsight[] {
  const out: PlatformInsight[] = [];
  for (const r of rows) {
    if (!isReadable(r, nowMs)) continue;
    const m = mapRow(r);
    if (m && platformCanAccess(role, platformInsightModule(m.kind))) out.push(m);
  }
  return out.sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(0, limit));
}
