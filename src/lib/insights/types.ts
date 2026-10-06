/**
 * Insight Engine — ortak tipler (SAF; sunucu modülü içermez, istemciden de import edilebilir).
 *
 * Bir içgörü: kanıtlı ("neden"), son geçerlilikli, filtrelenmiş hedefe (`href`) giden, ertelenebilir bir öneridir.
 * İçgörü HİÇBİR ŞEYİ kendi başına değiştirmez (fiyat, mesaj, atama): eylem kullanıcıdadır.
 */

export const INSIGHT_KINDS = [
  "call_priority",
  "deal_risk",
  "price_action",
  "match_suggestion",
  "anomaly",
  "forecast",
  "compliance",
  "deadline",
  "digest",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_SEVERITIES = ["bilgi", "orta", "yuksek"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_STATES = ["new", "seen", "snoozed", "dismissed", "accepted"] as const;
export type InsightState = (typeof INSIGHT_STATES)[number];

/** Yoksay nedeni (kapalı liste). `yanlis` kural kalite sayacını artırır. */
export const INSIGHT_DISMISS_REASONS = ["yanlis", "zaten_yaptim", "ilgisiz", "sonra"] as const;
export type InsightDismissReason = (typeof INSIGHT_DISMISS_REASONS)[number];

export const INSIGHT_CONFIDENCES = ["dusuk", "orta", "yuksek"] as const;
export type InsightConfidence = (typeof INSIGHT_CONFIDENCES)[number];

/** Kanıt satırı: yalnız etiket/değer (kimlik, telefon, e-posta YOK). */
export type InsightEvidence = { label: string; value: string; href?: string };

/** Kural çıktısı (alıcı çözülmeden önce). */
export type InsightDraft = {
  kind: InsightKind;
  /** Kural kimliği + sürüm, örn. "deal_risk@1". */
  ruleId: string;
  severity: InsightSeverity;
  title: string;
  /** "Neden?" tek paragraf (kural metni). */
  why: string;
  evidence: InsightEvidence[];
  /** Filtrelenmiş hedef; "/" ile başlar (şemada not null). */
  href: string;
  entityType: string | null;
  entityId: string | null;
  isForecast: boolean;
  confidence: InsightConfidence | null;
  /** Deterministik anahtar (kural:kayıt[:dönem]). */
  dedupeKey: string;
  /** Son geçerlilik (epoch ms). */
  validUntilMs: number;
  /** Alıcı: tek kullanıcı ya da yönetim rolleri (engine fan-out eder). */
  audience: { type: "user"; userId: string } | { type: "management" };
  /** Öncelik girdileri (priority.ts). */
  urgencyDays?: number | null;
  impact?: number | null;
};

/** Okuyucunun döndürdüğü içgörü (DB satırının camelCase karşılığı; ana ekran bunu kullanır). */
export type Insight = {
  id: string;
  kind: InsightKind;
  ruleId: string;
  severity: InsightSeverity;
  priority: number;
  title: string;
  why: string;
  evidence: InsightEvidence[];
  href: string;
  entityType: string | null;
  entityId: string | null;
  isForecast: boolean;
  confidence: InsightConfidence | null;
  state: InsightState;
  snoozedUntil: string | null;
  validUntil: string;
  createdAt: string;
  /** Opsiyonel AI anlatımı (yalnız digest; boş olabilir). */
  narrative: string | null;
  narrativeSource: "rule" | "ai";
};

export type InsightRole = string;

/** Ofis ayarı (oversight_settings.thresholds.insights): sessize alınan kurallar + LLM anlatımı (varsayılan KAPALI). */
export type InsightSettings = {
  /** Sessize alınan kural kimlikleri ("deal_risk" gibi sürümsüz taban ad da geçerli). */
  mutedRules: string[];
  /** LLM anlatımı: varsayılan false (maliyet + gizlilik). */
  narrativeEnabled: boolean;
};

export const DEFAULT_INSIGHT_SETTINGS: InsightSettings = { mutedRules: [], narrativeEnabled: false };

/** Yönetim rolleri (ofis geneli içgörü alıcıları). `hasOfficeWideDataScope` ile aynı küme. */
export const INSIGHT_MANAGEMENT_ROLES = ["owner", "gm", "branch_manager"] as const;

/** İçgörü ALMAYAN roller. */
export const INSIGHT_EXCLUDED_ROLES = ["readonly"] as const;

/** Kural kimliğinin sürümsüz taban adı ("deal_risk@1" -> "deal_risk"). */
export function ruleBase(ruleId: string): string {
  const at = ruleId.indexOf("@");
  return at === -1 ? ruleId : ruleId.slice(0, at);
}
