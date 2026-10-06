/**
 * Ofis Merkezi veri modeli (SAF tipler: sunucu/istemci ortak).
 * Rol etiketi `@/lib/role-labels`, metrik tanımı `@/lib/team/advisor-metrics`, puan `smart-assign.ts`.
 */

export type OfficeCenterTab = "danismanlar" | "atamalar" | "ayarlar" | "tanimlamalar" | "istatistikler";
export const OFFICE_CENTER_TABS: readonly { id: OfficeCenterTab; label: string }[] = [
  { id: "danismanlar", label: "Danışmanlar" },
  { id: "atamalar", label: "Atamalar" },
  { id: "ayarlar", label: "Ayarlar" },
  { id: "tanimlamalar", label: "Tanımlamalar" },
  { id: "istatistikler", label: "İstatistikler" },
];
export const OFFICE_CENTER_PATH = "/app/ofis-merkezi";

/** Danışmanlar sekmesi satırı: her sayı filtreli hedefe gider (sıfır çıkmaz metrik). */
export type OfficeAdvisorRow = {
  id: string;
  fullName: string;
  role: string;
  title: string | null;
  isActive: boolean;
  branchId: string | null;
  branchName: string | null;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  /** Açık portföy (draft/live/reserved, silinmemiş). */
  openProperties: number;
  /** Açık talep (müşterisi bu danışmana atanmış, status new/active/matched). */
  openDemands: number;
  /** Bu TR ayında kazanılan anlaşma (deals.stage=won, updated_at bu ayda). */
  wonThisMonth: number;
  /** İlk yanıt SLA uyumu (%) bu ay; ölçülecek kayıt yoksa null. */
  slaWithinPct: number | null;
  /** Son aktivite (arama/iletişim/portföy kaydı), ISO; 90 günde yoksa null. */
  lastActivityAt: string | null;
  onLeaveToday: boolean;
};

export type AdvisorSortKey = "ad" | "portfoy" | "talep" | "kapanis" | "sla" | "aktivite";
export type AdvisorStatusFilter = "" | "aktif" | "pasif";

export type AdvisorListFilters = {
  q: string;
  durum: AdvisorStatusFilter;
  rol: string;
  sube: string;
  sirala: AdvisorSortKey;
  yon: "asc" | "desc";
};

/** Havuzda/atanmamış bekleyen ilan (Atamalar sekmesi). */
export type UnassignedProperty = {
  id: string;
  title: string;
  propertyCode: string | null;
  propertyType: string | null;
  transactionType: string | null;
  listPrice: number | null;
  place: string;
  branchId: string | null;
  createdAt: string;
  /** Havuz kaydı varsa (listing_pool_entries pending). */
  poolEntryId: string | null;
  poolSince: string | null;
  poolSlaDueAt: string | null;
  slaState: "ok" | "due_soon" | "breached";
};

export type AssignmentMethod = "manual" | "smart" | "rule";
export type AssignmentStatus = "active" | "cancelled" | "reassigned";

export type PoolAssignmentRow = {
  id: string;
  propertyId: string;
  propertyTitle: string;
  assignedTo: string;
  assignedToName: string;
  previousAssignee: string | null;
  previousAssigneeName: string | null;
  assignedBy: string | null;
  assignedByName: string | null;
  method: AssignmentMethod;
  scoreTotal: number | null;
  reasonSummary: string | null;
  reason: string | null;
  status: AssignmentStatus;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type AssignmentHistoryFilter = "" | "aktif" | "iptal" | "yeniden";

/** Tanımlamalar sekmesi yapıları — hepsi registry anahtarlarına eşlenir (definitions.ts). */
export type SlaDefinition = {
  /** office.sla.lead_first_response_min (dakika; SLA_OPTIONS_MIN seçeneklerinden) */
  leadFirstResponseMin: number;
  /** office.assign.unassigned_sla_hours */
  unassignedSlaHours: number;
};

export type CommissionDefinition = {
  defaultRate: number;
  splitAdvisorShare: number;
  simulatorRate: number;
  simulatorAdvisorShare: number;
};

export type AlertThresholdDefinition = {
  dealStaleDays: number;
  demandAgingDays: number;
  unassignedPoolCount: number;
  customerQuietDays: number;
  listingStaleDays: number;
  dormantDays: number;
};

export type NotificationChannelDefinition = Record<string, boolean>;

export type OfficeStatistics = {
  totalProperties: number;
  liveProperties: number;
  unassignedProperties: number;
  wonDealsThisMonth: number;
  activeRentals: number;
  assignmentsThisMonth: number;
  cancelledAssignmentsThisMonth: number;
  activeAdvisors: number;
  inactiveAdvisors: number;
  /** Veri kaynaklarından biri okunamadı (sayılara güvenilmez). */
  failed: boolean;
};

export type TeamHealth = {
  level: "healthy" | "warning" | "critical";
  alerts: { text: string; href: string }[];
};
