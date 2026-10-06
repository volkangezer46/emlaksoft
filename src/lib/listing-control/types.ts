/**
 * Portföy-ilan yaşam döngüsü ve kayıp/kaçak denetimi: ORTAK TİPLER ve sabitler (SAF, DB/React yok).
 * Değerler 20260826002000..002070 migration CHECK listeleriyle BİREBİR aynıdır
 * (`listing-control-contract.test.ts` bunu denetler). Yeni değer = hem buraya hem migration'a (yeni dosya).
 */

export const CHECK_STATES = [
  "unchecked",
  "verified",
  "suspect",
  "probable_missing",
  "confirmed_missing",
  "unverifiable",
  "paused",
] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const CHECK_RESULTS = ["present", "absent", "blocked", "error"] as const;
export type CheckResultKind = (typeof CHECK_RESULTS)[number];

export const SOURCE_KINDS = ["manual", "api", "feed", "csv", "assisted"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Resmi/yetkili kaynak: tek gözlem yerine iki gözlemle onaylanır. */
export function isAuthoritativeSource(kind: SourceKind): boolean {
  return kind === "api" || kind === "feed" || kind === "csv";
}

export const ANOMALY_TYPES = [
  "portal_missing",
  "not_published",
  "unregistered_listing",
  "bulk_mismatch",
  "price_mismatch",
  "advisor_mismatch",
  "duplicate",
  "potential_lost_deal",
  "sold_still_listed",
  "incomplete_closure",
  "authority_expiring",
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

/** Motorun portföy başına eşitlediği (otomatik kapatabildiği) türler. bulk_mismatch/unregistered ofis geneli işlerdir. */
export const PROPERTY_MANAGED_ANOMALY_TYPES: readonly AnomalyType[] = [
  "portal_missing",
  "not_published",
  "price_mismatch",
  "advisor_mismatch",
  "potential_lost_deal",
  "sold_still_listed",
  "incomplete_closure",
  "authority_expiring",
];

export const ANOMALY_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_STATUSES = ["open", "acknowledged", "explained", "resolved", "false_positive", "auto_closed"] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

/** Açıklama nedenleri (kodlu). "Diğer" için not zorunlu. */
export const REASON_CODES = [
  "sold",
  "rented",
  "owner_withdrew",
  "authority_expired",
  "price_will_update",
  "portal_removed",
  "will_republish",
  "mistake",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABELS: Record<ReasonCode, string> = {
  sold: "Satıldı",
  rented: "Kiralandı",
  owner_withdrew: "Mal sahibi ilanı kaldırdı",
  authority_expired: "Yetki sona erdi",
  price_will_update: "Fiyat güncellenecek",
  portal_removed: "Portal kaldırdı",
  will_republish: "Yeniden yayınlanacak",
  mistake: "Yanlışlıkla kaldırıldı",
  other: "Diğer (not zorunlu)",
};

export const LIFECYCLE_STAGES = [
  "new",
  "pool",
  "assigned",
  "preparing",
  "ready",
  "published",
  "marketing",
  "offer",
  "negotiation",
  "deposit",
  "sold",
  "rented",
  "exited",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  new: "Yeni",
  pool: "Havuzda",
  assigned: "Danışmana atandı",
  preparing: "Hazırlanıyor",
  ready: "Yayına hazır",
  published: "Portalda yayında",
  marketing: "Pazarlama",
  offer: "Teklif",
  negotiation: "Pazarlık",
  deposit: "Kapora",
  sold: "Satıldı",
  rented: "Kiralandı",
  exited: "Çıkış",
};

export const EXIT_KINDS = [
  "sold",
  "rented",
  "cancelled",
  "authority_expired",
  "owner_withdrew",
  "other_agency",
  "portal_removed",
  "passive",
  "duplicate",
] as const;
export type ExitKind = (typeof EXIT_KINDS)[number];

export const EXIT_LABELS: Record<ExitKind, string> = {
  sold: "Satıldı",
  rented: "Kiralandı",
  cancelled: "İptal",
  authority_expired: "Yetki doldu",
  owner_withdrew: "Mal sahibi vazgeçti",
  other_agency: "Başka emlakçıya verildi",
  portal_removed: "Portal ilanı kaldırıldı",
  passive: "Pasife alındı",
  duplicate: "Kopya kayıt",
};

export const HEALTH_COLORS = ["green", "yellow", "orange", "red", "gray"] as const;
export type HealthColor = (typeof HEALTH_COLORS)[number];

/** KPI kümeleri (property_control_state.k_* kolonlarıyla bire bir; sayı = liste). */
export const KPI_KEYS = [
  "active",
  "in_portals",
  "awaiting_publish",
  "portal_missing",
  "price_mismatch",
  "in_review",
  "unverifiable",
  "healthy",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const KPI_LABELS: Record<KpiKey, string> = {
  active: "Toplam aktif portföy",
  in_portals: "Portallarda aktif",
  awaiting_publish: "Yayın bekleyen",
  portal_missing: "Portal ilanı kayıp",
  price_mismatch: "Fiyat uyuşmazlığı",
  in_review: "İnceleme (açıklama bekleyen)",
  unverifiable: "Kontrol edilemeyen",
  healthy: "Sağlıklı",
};

/** Portal ilan satırı durumu (portal_listings.status, text). 'superseded' = ilan no değişti, halef satır var. */
export type PortalListingStatus = "live" | "removed" | "superseded";

export type ScopeKind = "tenant" | "branch" | "team" | "advisor";

/** Rol hiyerarşisi (SLA alıcı çözümü ve kapsam için). */
export type ControlRole = "owner" | "gm" | "branch_manager" | "team_lead" | "advisor" | "call_center" | "accounting" | "readonly";
