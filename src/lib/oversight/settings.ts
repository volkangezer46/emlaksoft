/**
 * Ofis Kontrol Merkezi — esik ve onay kurali ayarlari (SAF, DB/React yok).
 *
 * Varsayilanlar makul ve danismani bunaltmaz: onay kurallari KAPALI, uyari esikleri
 * "gercekten dikkate deger" seviyede. Tablolar (oversight_settings) yokken de bu
 * varsayilanlarla calisilir.
 */

import { normalizeInsightSettings } from "@/lib/insights/settings";
import type { InsightSettings } from "@/lib/insights/types";

export const ALERT_RULE_IDS = [
  "price_drop",
  "listing_removed",
  "bulk_delete",
  "bulk_export",
  "reassign",
  "after_hours",
  "cert_expired",
  "stale_listing",
  "stale_customer",
  "commission_cut",
  "sensitive_download",
] as const;
export type AlertRuleId = (typeof ALERT_RULE_IDS)[number];

export type AlertRuleMeta = {
  label: string;
  /** Kural neyi, hangi veriyle yakalar (aciklanabilirlik). */
  description: string;
  /** Veri kaynagi var mi: false ise kural listelenir ama "veri kaynagi yok" denir (sahte vaat yok). */
  sourceAvailable: boolean;
};

export const ALERT_RULE_META: Record<AlertRuleId, AlertRuleMeta> = {
  price_drop: {
    label: "Büyük fiyat düşürme",
    description: "Bir ilanın fiyatı tek seferde eşik yüzdesinden fazla düşürüldü (fiyat geçmişi kaydı).",
    sourceAvailable: true,
  },
  listing_removed: {
    label: "İlan yayından kaldırma / silme",
    description: "Bir ilan silindi, portal yayını kapatıldı ya da toplu olarak yayından çıkarıldı (denetim kaydı).",
    sourceAvailable: true,
  },
  bulk_delete: {
    label: "Toplu müşteri silme",
    description: "Aynı kişi aynı günde eşik sayısından fazla müşteri sildi.",
    sourceAvailable: true,
  },
  bulk_export: {
    label: "Toplu dışa aktarma",
    description: "Bir dışa aktarma eşik satır sayısını aştı ya da aynı gün birden fazla kez veri indirildi.",
    sourceAvailable: true,
  },
  reassign: {
    label: "Müşteri / ilan devri",
    description: "Aynı kişi aynı günde eşik sayısından fazla müşteri veya ilanı başka danışmana devretti.",
    sourceAvailable: true,
  },
  after_hours: {
    label: "Mesai dışı yoğun işlem",
    description: "Mesai saatleri dışında bir günde eşik sayısından fazla işlem yapıldı.",
    sourceAvailable: true,
  },
  cert_expired: {
    label: "Yetki belgesi süresi dolmuş",
    description: "Yetki belgesinin süresi dolmuş danışmanın yayında ilanı var.",
    sourceAvailable: true,
  },
  stale_listing: {
    label: "Uzun süredir işlem görmeyen ilan",
    description: "Yayındaki ilan belirlenen gün sayısından uzun süredir güncellenmedi (sahipsiz kalma riski).",
    sourceAvailable: true,
  },
  stale_customer: {
    label: "Uzun süredir işlem görmeyen müşteri",
    description: "Atanmış müşteri belirlenen gün sayısından uzun süredir güncellenmedi.",
    sourceAvailable: true,
  },
  commission_cut: {
    label: "Komisyon oranını manuel düşürme",
    description: "Standart orandan eşik puandan fazla indirim için onay talebi açıldı.",
    sourceAvailable: true,
  },
  sensitive_download: {
    label: "Gizli / yüksek riskli belge indirme",
    description: "Belge indirmeleri henüz denetim kaydına yazılmıyor; kayıt eklendiğinde bu kural çalışır.",
    sourceAvailable: false,
  },
};

export type OversightThresholds = {
  priceDropPct: number;
  bulkDeleteCount: number;
  bulkExportRows: number;
  exportPerDay: number;
  reassignPerDay: number;
  afterHoursEvents: number;
  workStartHour: number;
  workEndHour: number;
  staleListingDays: number;
  staleCustomerDays: number;
  commissionCutPoints: number;
  enabled: Record<AlertRuleId, boolean>;
  /** Zeka katmani (Insight Engine) ofis ayari: sessiz kurallar + LLM anlatimi. Alan yoksa varsayilan (kapali). */
  insights?: InsightSettings;
};

export const DEFAULT_THRESHOLDS: OversightThresholds = {
  priceDropPct: 10,
  bulkDeleteCount: 5,
  bulkExportRows: 200,
  exportPerDay: 3,
  reassignPerDay: 5,
  afterHoursEvents: 20,
  workStartHour: 8,
  workEndHour: 20,
  staleListingDays: 60,
  staleCustomerDays: 45,
  commissionCutPoints: 1,
  enabled: Object.fromEntries(ALERT_RULE_IDS.map((r) => [r, true])) as Record<AlertRuleId, boolean>,
};

export type ThresholdNumField = Exclude<keyof OversightThresholds, "enabled" | "insights">;

/** Alan sinirlari: [min, max]. Form ve sunucu ayni sinirlari kullanir. */
export const THRESHOLD_LIMITS: Record<ThresholdNumField, readonly [number, number]> = {
  priceDropPct: [1, 90],
  bulkDeleteCount: [2, 500],
  bulkExportRows: [10, 100000],
  exportPerDay: [1, 100],
  reassignPerDay: [1, 500],
  afterHoursEvents: [3, 1000],
  workStartHour: [0, 23],
  workEndHour: [1, 24],
  staleListingDays: [7, 730],
  staleCustomerDays: [7, 730],
  commissionCutPoints: [0.1, 10],
};

function toNum(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number(raw.trim().replace(",", "."));
  return Number.NaN;
}

/** Ham jsonb / form degerini guvenli esiklere cevirir; eksik ya da bozuk alan varsayilana duser. */
export function normalizeThresholds(raw: unknown): OversightThresholds {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: OversightThresholds = { ...DEFAULT_THRESHOLDS, enabled: { ...DEFAULT_THRESHOLDS.enabled } };
  const target = out as unknown as Record<ThresholdNumField, number>;
  for (const f of Object.keys(THRESHOLD_LIMITS) as ThresholdNumField[]) {
    if (src[f] === undefined) continue;
    const n = toNum(src[f]);
    if (!Number.isFinite(n)) continue;
    const [min, max] = THRESHOLD_LIMITS[f];
    const v = Math.min(max, Math.max(min, n));
    target[f] = f === "commissionCutPoints" ? Math.round(v * 10) / 10 : Math.round(v);
  }
  if (out.workEndHour <= out.workStartHour) {
    out.workStartHour = DEFAULT_THRESHOLDS.workStartHour;
    out.workEndHour = DEFAULT_THRESHOLDS.workEndHour;
  }
  const en = src.enabled && typeof src.enabled === "object" ? (src.enabled as Record<string, unknown>) : {};
  for (const id of ALERT_RULE_IDS) {
    if (typeof en[id] === "boolean") out.enabled[id] = en[id] as boolean;
  }
  // Insight ayari bu jsonb'de TASINIR; ofis kontrol formu kaydederken silinmesin diye burada korunur.
  if (src.insights !== undefined) out.insights = normalizeInsightSettings(src.insights);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Onay kurallari                                                              */
/* -------------------------------------------------------------------------- */

export const APPROVAL_ACTION_TYPES = ["price_drop", "commission_discount", "listing_delete", "bulk_export"] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export type ApprovalRule = {
  enabled: boolean;
  /** price_drop: yuzde; commission_discount: puan; bulk_export: satir; listing_delete: kullanilmaz. */
  threshold: number;
};
export type ApprovalRules = Record<ApprovalActionType, ApprovalRule>;

export const APPROVAL_ACTION_META: Record<
  ApprovalActionType,
  { label: string; description: string; thresholdLabel: string | null; defaultThreshold: number; limits: readonly [number, number] }
> = {
  price_drop: {
    label: "Eşik üstü fiyat düşürme",
    description: "İlan fiyatı eşik yüzdesinden fazla düşürülmek istendiğinde yönetici onayı gerekir.",
    thresholdLabel: "Düşüş eşiği (%)",
    defaultThreshold: 15,
    limits: [1, 90],
  },
  commission_discount: {
    label: "Komisyon indirimi",
    description: "Standart orandan eşik puandan fazla indirim için yönetici onayı gerekir.",
    thresholdLabel: "İndirim eşiği (puan)",
    defaultThreshold: 1,
    limits: [0.1, 10],
  },
  listing_delete: {
    label: "İlan silme",
    description: "İlan silme işlemi yönetici onayından sonra yapılabilir.",
    thresholdLabel: null,
    defaultThreshold: 0,
    limits: [0, 0],
  },
  bulk_export: {
    label: "Toplu dışa aktarma",
    description: "Eşik satır sayısını aşan veri indirme yönetici onayı ister.",
    thresholdLabel: "Satır eşiği",
    defaultThreshold: 100,
    limits: [10, 100000],
  },
};

/** Varsayilan: hepsi KAPALI — danismani yavaslatma. */
export function defaultApprovalRules(): ApprovalRules {
  return Object.fromEntries(
    APPROVAL_ACTION_TYPES.map((t) => [t, { enabled: false, threshold: APPROVAL_ACTION_META[t].defaultThreshold }]),
  ) as ApprovalRules;
}

export function normalizeApprovalRules(raw: unknown): ApprovalRules {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = defaultApprovalRules();
  for (const t of APPROVAL_ACTION_TYPES) {
    const r = src[t];
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const meta = APPROVAL_ACTION_META[t];
    out[t].enabled = rec.enabled === true;
    if (meta.thresholdLabel && rec.threshold !== undefined) {
      const n = toNum(rec.threshold);
      if (Number.isFinite(n)) out[t].threshold = Math.min(meta.limits[1], Math.max(meta.limits[0], n));
    }
  }
  return out;
}
