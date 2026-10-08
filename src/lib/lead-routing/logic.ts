/**
 * Talep dağıtımı (lead routing) — SAF karar katmanı (veri çekmez, saat okumaz).
 *
 * TEK MOTOR: aday elemesi, bölge/uzmanlık/iş yükü puanı ve adil dağıtımlı sıralama ilan havuzu ve Ofis Merkezi akıllı atama ile
 * AYNI kodu kullanır (`@/lib/pool/score` + `@/lib/office-center/smart-assign`); burada yalnız TALEP için üç strateji ve SLA/mesai
 * kuralları vardır:
 *   least_loaded — en az açık talebi olan (bugünkü varsayılan davranış)
 *   round_robin  — sırayla (en eski atama alan öne geçer)
 *   smart        — bölge/ilçe uzmanlığı + portföy türü + iş yükü + müsaitlik puanı (ofis ağırlıklarıyla)
 * SLA: ilk dönüş süresi ÇALIŞMA dakikasıyla ölçülür (`workingMinutesBetween`, aday hızı raporuyla aynı tanım); dolunca
 * (ofis açtıysa) başka danışmana yeniden atanır, en çok `maxReassign` kez ve her atamadan sonra yeni süre tanınır.
 */
import { rankAdvisorsForProperty, smartExclusionReason, type SmartCandidate, type SmartContext } from "@/lib/office-center/smart-assign";
import type { PoolProperty } from "@/lib/pool/score";
import { isWorkingTime, workingMinutesBetween } from "@/lib/response-time/core";

export type LeadRoutingStrategy = "least_loaded" | "round_robin" | "smart";

export const LEAD_ROUTING_STRATEGIES: readonly { value: LeadRoutingStrategy; label: string; description: string }[] = [
  { value: "least_loaded", label: "En az yüklü", description: "Açık talebi en az olan danışmana atanır (varsayılan)." },
  { value: "round_robin", label: "Sırayla (döngüsel)", description: "En uzun süredir talep almayan danışmandan başlayarak sırayla atanır." },
  { value: "smart", label: "Akıllı (uzmanlık + yük)", description: "Bölge/ilçe uzmanlığı, portföy türü, iş yükü ve müsaitlik puanıyla; ağırlıklar Tanımlar sekmesindedir." },
] as const;

export function isLeadRoutingStrategy(v: unknown): v is LeadRoutingStrategy {
  return v === "least_loaded" || v === "round_robin" || v === "smart";
}

export type LeadRoutingConfig = {
  strategy: LeadRoutingStrategy;
  /** Mesai dışı gelen talep atanmadan bekler, mesai başında dağıtılır. */
  hoursOnly: boolean;
  /** İlk dönüş SLA'sı dolunca başka danışmana yeniden ata. */
  reassignOnBreach: boolean;
  /** Bir talep en çok kaç kez yeniden atanır. */
  maxReassign: number;
  /** İlk dönüş SLA'sı (dakika). */
  slaMinutes: number;
};

export const DEFAULT_LEAD_ROUTING: LeadRoutingConfig = {
  strategy: "least_loaded",
  hoursOnly: false,
  reassignOnBreach: false,
  maxReassign: 2,
  slaMinutes: 60,
};

export type LeadFacts = {
  propertyType?: string | null;
  transactionType?: string | null;
  provinceId?: string | null;
  districtId?: string | null;
  neighborhoodId?: string | null;
  /** Bütçe üst sınırı: fiyat bandı uzmanlığı için "fiyat" yerine kullanılır. */
  budgetMax?: number | null;
};

/** Talep -> havuz puanlayıcısının beklediği girdi (aynı motor). */
export function leadToPoolProperty(lead: LeadFacts): PoolProperty {
  return {
    propertyType: lead.propertyType ?? null,
    transactionType: lead.transactionType ?? null,
    provinceId: lead.provinceId ?? null,
    districtId: lead.districtId ?? null,
    neighborhoodId: lead.neighborhoodId ?? null,
    listPrice: lead.budgetMax != null && lead.budgetMax > 0 ? lead.budgetMax : null,
  };
}

export type LeadCandidate = SmartCandidate & { role: string };

/** Danışman rolleri öncelikli; hiçbiri uygun değilse yönetici rollerine düşülür (bugünkü kural). */
const FRONTLINE_ROLES = ["advisor", "team_lead"];

export type RoutingCandidateView = { profileId: string; name: string; score: number | null; summary: string };
export type RoutingDecision = {
  profileId: string | null;
  strategy: LeadRoutingStrategy;
  /** Tek satır gerekçe (denetim/bildirim; kişisel veri yok). */
  reason: string;
  /** Uygun adaylar karar sırasıyla (en çok 5). */
  ranking: RoutingCandidateView[];
};

const byLeast = (a: LeadCandidate, b: LeadCandidate): number =>
  a.openDemands - b.openDemands ||
  (a.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY) - (b.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY) ||
  a.name.localeCompare(b.name, "tr");

const byOldest = (a: LeadCandidate, b: LeadCandidate): number =>
  (a.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY) - (b.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY) ||
  a.openDemands - b.openDemands ||
  a.name.localeCompare(b.name, "tr");

/**
 * Talep için danışman seçer. `excludeIds`: yeniden atamada mevcut/önceki sorumlu. Uygun aday yoksa profileId null.
 * Eleme kuralları havuzla aynıdır (pasif, izinli, duraklatılmış, kural dışı...) — kapasite talepte uygulanmaz
 * (aday yükleyici `capacity`'yi null verir).
 */
export function pickLeadAssignee(args: {
  strategy: LeadRoutingStrategy;
  candidates: readonly LeadCandidate[];
  lead: LeadFacts;
  ctx: SmartContext;
  excludeIds?: readonly string[];
}): RoutingDecision {
  const skip = new Set(args.excludeIds ?? []);
  const eligible = args.candidates.filter((c) => !skip.has(c.profileId) && smartExclusionReason(c, args.ctx) === null);
  const front = eligible.filter((c) => FRONTLINE_ROLES.includes(c.role));
  const pool = front.length > 0 ? front : eligible;
  if (pool.length === 0) return { profileId: null, strategy: args.strategy, reason: "Uygun danışman yok", ranking: [] };

  if (args.strategy === "smart") {
    const ranked = rankAdvisorsForProperty(leadToPoolProperty(args.lead), pool, args.ctx).filter((s) => !s.excluded);
    const top = ranked[0];
    return {
      profileId: top ? top.profileId : null,
      strategy: "smart",
      reason: top ? `Akıllı atama: ${top.summary}` : "Uygun danışman yok",
      ranking: ranked.slice(0, 5).map((s) => ({ profileId: s.profileId, name: s.name, score: s.score, summary: s.summary })),
    };
  }

  const sorted = [...pool].sort(args.strategy === "round_robin" ? byOldest : byLeast);
  const top = sorted[0]!;
  return {
    profileId: top.profileId,
    strategy: args.strategy,
    reason: args.strategy === "round_robin" ? "Sıradaki danışman (en uzun süredir talep almayan)" : `En az yüklü danışman (${top.openDemands} açık talep)`,
    ranking: sorted.slice(0, 5).map((c) => ({ profileId: c.profileId, name: c.name, score: null, summary: `${c.openDemands} açık talep` })),
  };
}

/** Mesai içinde mi (aday hızı raporu ile aynı tanım: TR Pzt-Cmt 09:00-19:00)? */
export function withinBusinessHours(nowMs: number): boolean {
  return isWorkingTime(nowMs);
}

/** Yeni gelen talep şimdi atanmalı mı yoksa mesai başına mı bırakılmalı? */
export function shouldDeferAssignment(config: Pick<LeadRoutingConfig, "hoursOnly">, nowMs: number): boolean {
  return config.hoursOnly && !withinBusinessHours(nowMs);
}

export type SlaInput = {
  /** Talebin açıldığı an (ISO). */
  createdAt: string;
  /** Son (yeniden) atama anı (ISO); yoksa createdAt. SLA süresi buradan başlar. */
  lastAssignedAt?: string | null;
  responded: boolean;
  nowMs: number;
  slaMinutes: number;
};

/** İlk dönüş SLA'sı doldu mu (çalışma dakikasıyla, son atamadan itibaren)? Yanıtlanmış talep asla ihlal sayılmaz. */
export function isLeadSlaBreached(i: SlaInput): boolean {
  if (i.responded) return false;
  const start = Date.parse(i.lastAssignedAt || i.createdAt);
  if (Number.isNaN(start)) return false;
  return workingMinutesBetween(start, i.nowMs) > i.slaMinutes;
}

/** Yeniden atama kararı (saf): ayar açık, SLA doldu, üst sınır aşılmadı. */
export function decideReassign(i: SlaInput & { enabled: boolean; reassignCount: number; maxReassign: number }): "reassign" | "escalate" | "wait" {
  if (!i.enabled) return "wait";
  if (!isLeadSlaBreached(i)) return "wait";
  return i.reassignCount >= i.maxReassign ? "escalate" : "reassign";
}

/** Ayar değerlerinden (tipli sözlük) yapılandırma; bozuk/eksik değer varsayılana düşer. */
export function leadRoutingConfigFrom(values: Record<string, unknown>, keys: { strategy: string; hoursOnly: string; reassign: string; maxReassign: string; slaMin: string }): LeadRoutingConfig {
  const strategy = values[keys.strategy];
  const maxR = Number(values[keys.maxReassign]);
  const sla = Number(values[keys.slaMin]);
  return {
    strategy: isLeadRoutingStrategy(strategy) ? strategy : DEFAULT_LEAD_ROUTING.strategy,
    hoursOnly: values[keys.hoursOnly] === true,
    reassignOnBreach: values[keys.reassign] === true,
    maxReassign: Number.isFinite(maxR) ? Math.min(5, Math.max(1, Math.trunc(maxR))) : DEFAULT_LEAD_ROUTING.maxReassign,
    slaMinutes: Number.isFinite(sla) && sla > 0 ? sla : DEFAULT_LEAD_ROUTING.slaMinutes,
  };
}
